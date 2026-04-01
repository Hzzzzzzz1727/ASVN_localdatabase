param(
  [Parameter(Mandatory = $true)]
  [string]$ConnectionString,
  [Parameter(Mandatory = $true)]
  [string]$QueryBase64,
  [Parameter(Mandatory = $true)]
  [string]$ParamsBase64
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Data

$query = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($QueryBase64))
$paramsJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ParamsBase64))
$params = @()
if ($paramsJson -and $paramsJson -ne 'null') {
  $parsed = $paramsJson | ConvertFrom-Json
  if ($parsed -is [System.Collections.IEnumerable]) {
    $params = @($parsed)
  } elseif ($parsed) {
    $params = @($parsed)
  }
}

$cn = New-Object System.Data.SqlClient.SqlConnection $ConnectionString
$cn.Open()

try {
  $cmd = $cn.CreateCommand()
  $cmd.CommandText = $query
  $cmd.CommandTimeout = 0

  foreach ($param in $params) {
    $name = $param.name
    $value = $param.value
    $type = $param.type
    $p = $cmd.Parameters.AddWithValue($name, [DBNull]::Value)

    if ($null -eq $value) {
      $p.Value = [DBNull]::Value
      continue
    }

    switch ($type) {
      'BigInt' { $p.Value = [Int64]$value; break }
      'Int' { $p.Value = [Int32]$value; break }
      'Bit' { $p.Value = [bool]$value; break }
      'Decimal' { $p.Value = [decimal]$value; break }
      'UniqueIdentifier' { $p.Value = [Guid]$value; break }
      'DateTime2' { $p.Value = [datetime]$value; break }
      default { $p.Value = [string]$value; break }
    }
  }

  $adapter = New-Object System.Data.SqlClient.SqlDataAdapter $cmd
  $dataSet = New-Object System.Data.DataSet
  [void]$adapter.Fill($dataSet)

  $rows = @()
  if ($dataSet.Tables.Count -gt 0) {
    foreach ($row in $dataSet.Tables[0].Rows) {
      $obj = [ordered]@{}
      foreach ($col in $dataSet.Tables[0].Columns) {
        $cell = $row[$col.ColumnName]
        $obj[$col.ColumnName] = if ($cell -eq [DBNull]::Value) { $null } else { $cell }
      }
      $rows += [pscustomobject]$obj
    }
  }

  $result = [ordered]@{
    recordset = $rows
  }
  $result | ConvertTo-Json -Depth 20 -Compress
}
finally {
  $cn.Dispose()
}
