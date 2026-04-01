param(
  [string]$ServerInstance = "localhost",
  [string]$DatabaseName = "ASVN_Local",
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Data

$outputDir = Join-Path $ProjectRoot "migration-output"

$tables = @(
  @{
    Name = "customers"
    JsonPath = Join-Path $outputDir "customers.json"
    PrimaryKey = "id"
    Columns = [ordered]@{
      id = "BIGINT"
      ticketId = "NVARCHAR(100)"
      name = "NVARCHAR(255)"
      phone = "NVARCHAR(50)"
      model = "NVARCHAR(255)"
      address = "NVARCHAR(500)"
      issue = "NVARCHAR(MAX)"
      status = "INT"
      replacedPart = "NVARCHAR(MAX)"
      doneDate = "NVARCHAR(50)"
      createdAt = "DATETIME2"
      folderDrive = "NVARCHAR(1000)"
      warehouse = "NVARCHAR(255)"
      serial = "NVARCHAR(255)"
      branch = "NVARCHAR(255)"
      statusLog = "NVARCHAR(MAX)"
      price = "DECIMAL(18,2)"
      lkItems = "NVARCHAR(MAX)"
      warranty_months = "INT"
      warranty_start_at = "DATETIME2"
      warranty_expires_at = "DATETIME2"
      media = "NVARCHAR(MAX)"
    }
  },
  @{
    Name = "profiles"
    JsonPath = Join-Path $outputDir "profiles.json"
    PrimaryKey = "id"
    Columns = [ordered]@{
      id = "UNIQUEIDENTIFIER"
      email = "NVARCHAR(255)"
      full_name = "NVARCHAR(255)"
      role = "NVARCHAR(50)"
      warehouse = "NVARCHAR(255)"
      is_active = "BIT"
      created_at = "DATETIME2"
      updated_at = "DATETIME2"
    }
  },
  @{
    Name = "customer_share_links"
    JsonPath = Join-Path $outputDir "customer_share_links.json"
    PrimaryKey = "id"
    Columns = [ordered]@{
      id = "BIGINT"
      customer_id = "BIGINT"
      share_token = "NVARCHAR(255)"
      share_enabled = "BIT"
      public_payload = "NVARCHAR(MAX)"
      created_by = "UNIQUEIDENTIFIER"
      created_at = "DATETIME2"
      updated_at = "DATETIME2"
    }
  }
)

$jsonColumns = @("statusLog", "lkItems", "media", "public_payload")
$dateColumns = @("createdAt", "warranty_start_at", "warranty_expires_at", "created_at", "updated_at")
$boolColumns = @("is_active", "share_enabled")

function Open-SqlConnection {
  param(
    [string]$ConnectionString
  )

  $connection = New-Object System.Data.SqlClient.SqlConnection $ConnectionString
  $connection.Open()
  return $connection
}

function Get-PreferredServerInstance {
  param(
    [string]$RequestedServer
  )

  $candidates = @($RequestedServer)
  if ($env:COMPUTERNAME -and $env:COMPUTERNAME -notin $candidates) {
    $candidates += $env:COMPUTERNAME
  }

  foreach ($candidate in $candidates) {
    try {
      $probe = Open-SqlConnection "Server=$candidate;Database=master;Integrated Security=True;TrustServerCertificate=True;Encrypt=False;"
      $probe.Dispose()
      return $candidate
    } catch {
      continue
    }
  }

  throw "Khong the ket noi SQL Server bang '$RequestedServer' hoac '$env:COMPUTERNAME'."
}

function Invoke-NonQuery {
  param(
    [System.Data.SqlClient.SqlConnection]$Connection,
    [string]$Sql,
    [hashtable]$Parameters = @{}
  )

  $command = $Connection.CreateCommand()
  $command.CommandText = $Sql
  $command.CommandTimeout = 0

  foreach ($entry in $Parameters.GetEnumerator()) {
    $parameterValue = $entry.Value
    $parameterType = $null

    if ($parameterValue -is [hashtable]) {
      $parameterType = $parameterValue["Type"]
      $parameterValue = $parameterValue["Value"]
    }

    if ($parameterType) {
      switch -Regex ($parameterType) {
        '^NVARCHAR\(MAX\)$' {
          $parameter = $command.Parameters.Add($entry.Key, [System.Data.SqlDbType]::NVarChar, -1)
          break
        }
        '^NVARCHAR\((\d+)\)$' {
          $parameter = $command.Parameters.Add($entry.Key, [System.Data.SqlDbType]::NVarChar, [int]$Matches[1])
          break
        }
        '^UNIQUEIDENTIFIER$' {
          $parameter = $command.Parameters.Add($entry.Key, [System.Data.SqlDbType]::UniqueIdentifier)
          break
        }
        '^DATETIME2$' {
          $parameter = $command.Parameters.Add($entry.Key, [System.Data.SqlDbType]::DateTime2)
          break
        }
        '^BIT$' {
          $parameter = $command.Parameters.Add($entry.Key, [System.Data.SqlDbType]::Bit)
          break
        }
        '^BIGINT$' {
          $parameter = $command.Parameters.Add($entry.Key, [System.Data.SqlDbType]::BigInt)
          break
        }
        '^INT$' {
          $parameter = $command.Parameters.Add($entry.Key, [System.Data.SqlDbType]::Int)
          break
        }
        '^DECIMAL\((\d+),(\d+)\)$' {
          $parameter = $command.Parameters.Add($entry.Key, [System.Data.SqlDbType]::Decimal)
          $parameter.Precision = [byte]$Matches[1]
          $parameter.Scale = [byte]$Matches[2]
          break
        }
        default {
          $parameter = $command.Parameters.AddWithValue($entry.Key, $parameterValue)
        }
      }
    } else {
      $parameter = $command.Parameters.AddWithValue($entry.Key, $parameterValue)
    }

    if ($parameterType -eq 'UNIQUEIDENTIFIER' -and [string]::IsNullOrWhiteSpace([string]$parameterValue)) {
      $parameter.Value = [DBNull]::Value
    } elseif ($parameterType -eq 'DATETIME2' -and [string]::IsNullOrWhiteSpace([string]$parameterValue)) {
      $parameter.Value = [DBNull]::Value
    } elseif ($parameterValue -eq $null) {
      $parameter.Value = [DBNull]::Value
    } else {
      $parameter.Value = $parameterValue
    }
  }

  [void]$command.ExecuteNonQuery()
}

function Convert-Value {
  param(
    [string]$ColumnName,
    $Value
  )

  if ($null -eq $Value) { return $null }

  if ($jsonColumns -contains $ColumnName) {
    return ($Value | ConvertTo-Json -Depth 100 -Compress)
  }

  if ($boolColumns -contains $ColumnName) {
    return [bool]$Value
  }

  if ($dateColumns -contains $ColumnName) {
    if ([string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
    return [DateTime]::Parse([string]$Value)
  }

  return $Value
}

function Ensure-Database {
  param(
    [string]$ServerInstance,
    [string]$DatabaseName
  )

  $masterConnection = Open-SqlConnection "Server=$ServerInstance;Database=master;Integrated Security=True;TrustServerCertificate=True;"
  try {
    $sql = @"
IF DB_ID(@dbName) IS NULL
BEGIN
  DECLARE @createSql nvarchar(max) = N'CREATE DATABASE [' + REPLACE(@dbName, ']', ']]') + N']';
  EXEC (@createSql);
END
"@
    Invoke-NonQuery -Connection $masterConnection -Sql $sql -Parameters @{ "@dbName" = $DatabaseName }
  }
  finally {
    $masterConnection.Dispose()
  }
}

function Ensure-Table {
  param(
    [System.Data.SqlClient.SqlConnection]$Connection,
    [hashtable]$Table
  )

  $defs = foreach ($entry in $Table.Columns.GetEnumerator()) {
    $nullability = if ($entry.Key -eq $Table.PrimaryKey) { "NOT NULL" } else { "NULL" }
    "[$($entry.Key)] $($entry.Value) $nullability"
  }
  $defs += "CONSTRAINT [PK_$($Table.Name)] PRIMARY KEY ([$($Table.PrimaryKey)])"

  $sql = @"
IF OBJECT_ID(N'dbo.$($Table.Name)', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[$($Table.Name)] (
    $($defs -join ",`n    ")
  );
END
"@
  Invoke-NonQuery -Connection $Connection -Sql $sql
}

function Upsert-Row {
  param(
    [System.Data.SqlClient.SqlConnection]$Connection,
    [hashtable]$Table,
    [pscustomobject]$Row
  )

  $columns = @($Table.Columns.Keys)
  $updateColumns = @($columns | Where-Object { $_ -ne $Table.PrimaryKey })
  $sourceSelect = ($columns | ForEach-Object { "@$_ AS [$_]" }) -join ", "
  $insertColumns = ($columns | ForEach-Object { "[$_]" }) -join ", "
  $insertValues = ($columns | ForEach-Object { "source.[$_]" }) -join ", "
  $updateSet = ($updateColumns | ForEach-Object { "target.[$_] = source.[$_]" }) -join ", "

  $sql = @"
MERGE [dbo].[$($Table.Name)] AS target
USING (SELECT $sourceSelect) AS source
ON target.[$($Table.PrimaryKey)] = source.[$($Table.PrimaryKey)]
WHEN MATCHED THEN
  UPDATE SET $updateSet
WHEN NOT MATCHED BY TARGET THEN
  INSERT ($insertColumns)
  VALUES ($insertValues);
"@

  $parameters = @{}
  foreach ($column in $columns) {
    $property = $Row.PSObject.Properties[$column]
    $value = if ($null -ne $property) { $property.Value } else { $null }
    $parameters["@$column"] = @{
      Type = $Table.Columns[$column]
      Value = (Convert-Value -ColumnName $column -Value $value)
    }
  }

  Invoke-NonQuery -Connection $Connection -Sql $sql -Parameters $parameters
}

$resolvedServer = Get-PreferredServerInstance -RequestedServer $ServerInstance

Ensure-Database -ServerInstance $resolvedServer -DatabaseName $DatabaseName

$dbConnection = Open-SqlConnection "Server=$resolvedServer;Database=$DatabaseName;Integrated Security=True;TrustServerCertificate=True;Encrypt=False;"

try {
  foreach ($table in $tables) {
    if (-not (Test-Path $table.JsonPath)) {
      throw "Khong tim thay file $($table.JsonPath)"
    }

    Ensure-Table -Connection $dbConnection -Table $table

    $rows = Get-Content $table.JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($rows -isnot [System.Collections.IEnumerable]) {
      $rows = @($rows)
    }

    $count = 0
    foreach ($row in $rows) {
      Upsert-Row -Connection $dbConnection -Table $table -Row $row
      $count++
    }

    Write-Host "Imported $count row(s) into $($table.Name)"
  }
}
finally {
  $dbConnection.Dispose()
}

Write-Host "Completed import into $resolvedServer / $DatabaseName"
