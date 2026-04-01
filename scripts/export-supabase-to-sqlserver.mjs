import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

const rootDir = process.cwd()
const outputDir = path.join(rootDir, 'migration-output')

const env = {
  supabaseUrl: process.env.SUPABASE_URL || 'https://aitgsajahebfyppfxkxi.supabase.co',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpdGdzYWphaGViZnlwcGZ4a3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5ODQ2MDcsImV4cCI6MjA4NDU2MDYwN30.TYhSle7DivWo8L10Hr3zN9waOfObYd7DxW544CGalS8',
  supabaseEmail: process.env.SUPABASE_EMAIL,
  supabasePassword: process.env.SUPABASE_PASSWORD,
  batchSize: Number(process.env.SUPABASE_BATCH_SIZE || 1000)
}

const tableConfigs = [
  {
    table: 'customers',
    orderBy: 'id',
    primaryKey: 'id',
    schema: {
      id: 'BIGINT',
      ticketId: 'NVARCHAR(100)',
      name: 'NVARCHAR(255)',
      phone: 'NVARCHAR(50)',
      model: 'NVARCHAR(255)',
      address: 'NVARCHAR(500)',
      issue: 'NVARCHAR(MAX)',
      status: 'INT',
      replacedPart: 'NVARCHAR(MAX)',
      doneDate: 'NVARCHAR(50)',
      createdAt: 'DATETIME2',
      folderDrive: 'NVARCHAR(1000)',
      warehouse: 'NVARCHAR(255)',
      serial: 'NVARCHAR(255)',
      branch: 'NVARCHAR(255)',
      statusLog: 'NVARCHAR(MAX)',
      price: 'DECIMAL(18,2)',
      lkItems: 'NVARCHAR(MAX)',
      warranty_months: 'INT',
      warranty_start_at: 'DATETIME2',
      warranty_expires_at: 'DATETIME2',
      media: 'NVARCHAR(MAX)'
    }
  },
  {
    table: 'profiles',
    orderBy: 'created_at',
    primaryKey: 'id',
    schema: {
      id: 'UNIQUEIDENTIFIER',
      email: 'NVARCHAR(255)',
      full_name: 'NVARCHAR(255)',
      role: 'NVARCHAR(50)',
      warehouse: 'NVARCHAR(255)',
      is_active: 'BIT',
      created_at: 'DATETIME2',
      updated_at: 'DATETIME2'
    }
  },
  {
    table: 'customer_share_links',
    orderBy: 'id',
    primaryKey: 'id',
    schema: {
      id: 'BIGINT',
      customer_id: 'BIGINT',
      share_token: 'NVARCHAR(255)',
      share_enabled: 'BIT',
      public_payload: 'NVARCHAR(MAX)',
      created_by: 'UNIQUEIDENTIFIER',
      created_at: 'DATETIME2',
      updated_at: 'DATETIME2'
    }
  }
]

const jsonColumns = new Set(['lkItems', 'statusLog', 'media', 'public_payload'])
const dateColumns = new Set(['createdAt', 'warranty_start_at', 'warranty_expires_at', 'created_at', 'updated_at'])
const numericColumns = new Set(['price'])
const intColumns = new Set(['id', 'customer_id', 'status', 'warranty_months'])
const boolColumns = new Set(['is_active', 'share_enabled'])

function inferSqlType(columnName, values) {
  const known = tableConfigs.flatMap((item) => Object.entries(item.schema))
    .find(([name]) => name === columnName)?.[1]
  if (known) return known

  const nonNullValues = values.filter((value) => value !== null && value !== undefined)
  if (nonNullValues.length === 0) return 'NVARCHAR(MAX)'
  if (jsonColumns.has(columnName)) return 'NVARCHAR(MAX)'
  if (dateColumns.has(columnName)) return 'DATETIME2'
  if (boolColumns.has(columnName)) return 'BIT'
  if (intColumns.has(columnName)) return 'BIGINT'
  if (numericColumns.has(columnName)) return 'DECIMAL(18,2)'

  const first = nonNullValues[0]
  if (typeof first === 'boolean') return 'BIT'
  if (typeof first === 'number') return Number.isInteger(first) ? 'BIGINT' : 'DECIMAL(18,6)'
  if (typeof first === 'object') return 'NVARCHAR(MAX)'
  if (typeof first === 'string') {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(first)) return 'UNIQUEIDENTIFIER'
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(first)) return 'DATETIME2'
    return first.length <= 255 ? 'NVARCHAR(255)' : 'NVARCHAR(MAX)'
  }

  return 'NVARCHAR(MAX)'
}

function normalizeValue(columnName, value) {
  if (value === undefined) return null
  if (value === null) return null
  if (jsonColumns.has(columnName)) return JSON.stringify(value)
  if (boolColumns.has(columnName)) return value ? 1 : 0
  if (dateColumns.has(columnName) && typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

function sqlLiteral(columnName, value) {
  const normalized = normalizeValue(columnName, value)
  if (normalized === null) return 'NULL'
  if (boolColumns.has(columnName)) return normalized ? '1' : '0'
  if (typeof normalized === 'number') return String(normalized)
  if (dateColumns.has(columnName)) return `CAST(${sqlNVarChar(normalized)} AS DATETIME2)`
  if (['UNIQUEIDENTIFIER'].includes(inferSqlType(columnName, [normalized]))) return `CAST(${sqlNVarChar(normalized)} AS UNIQUEIDENTIFIER)`
  return sqlNVarChar(String(normalized))
}

function sqlNVarChar(value) {
  return `N'${String(value).replace(/'/g, "''")}'`
}

function collectColumns(rows, preferredSchema = {}) {
  const columns = new Map()
  Object.entries(preferredSchema).forEach(([name, type]) => {
    columns.set(name, { type, values: [] })
  })

  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (!columns.has(key)) columns.set(key, { type: null, values: [] })
      columns.get(key).values.push(value)
    }
  }

  return [...columns.entries()].map(([name, info]) => ({
    name,
    type: info.type || inferSqlType(name, info.values)
  }))
}

function canonicalizeRow(row, preferredSchema = {}) {
  const canonicalByLower = Object.keys(preferredSchema).reduce((acc, key) => {
    acc[key.toLowerCase()] = key
    return acc
  }, {})

  const normalized = {}

  for (const [key, value] of Object.entries(row)) {
    const canonicalKey = canonicalByLower[key.toLowerCase()] || key
    if (!(canonicalKey in normalized) || canonicalKey === key) {
      normalized[canonicalKey] = value
    }
  }

  return normalized
}

function createTableSql(tableName, columns, primaryKey) {
  const defs = columns.map(({ name, type }) => {
    const nullability = name === primaryKey ? 'NOT NULL' : 'NULL'
    return `    [${name}] ${type} ${nullability}`
  })

  if (primaryKey) {
    defs.push(`    CONSTRAINT [PK_${tableName}] PRIMARY KEY ([${primaryKey}])`)
  }

  return [
    `IF OBJECT_ID(N'dbo.${tableName}', N'U') IS NULL`,
    'BEGIN',
    `  CREATE TABLE [dbo].[${tableName}] (`,
    defs.join(',\n'),
    '  );',
    'END;',
    'GO',
    ''
  ].join('\n')
}

function chunkArray(items, size) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function createMergeSql(tableName, columns, primaryKey, rows) {
  if (rows.length === 0) {
    return [
      `PRINT N'Bo qua ${tableName}: khong co du lieu de import.';`,
      'GO',
      ''
    ].join('\n')
  }

  const columnNames = columns.map((column) => column.name)
  const updateColumns = columnNames.filter((name) => name !== primaryKey)
  const rowChunks = chunkArray(rows, 500)

  return rowChunks.map((chunk, index) => {
    const sourceRows = chunk.map((row) => `(${columnNames.map((name) => sqlLiteral(name, row[name])).join(', ')})`)
    const mergeSql = [
      `PRINT N'Import ${tableName} - batch ${index + 1}/${rowChunks.length}';`,
      `MERGE [dbo].[${tableName}] AS target`,
      `USING (VALUES`,
      sourceRows.map((line) => `  ${line}`).join(',\n'),
      `) AS source (${columnNames.map((name) => `[${name}]`).join(', ')})`,
      `ON target.[${primaryKey}] = source.[${primaryKey}]`,
      updateColumns.length
        ? `WHEN MATCHED THEN UPDATE SET ${updateColumns.map((name) => `target.[${name}] = source.[${name}]`).join(', ')}`
        : '',
      `WHEN NOT MATCHED BY TARGET THEN INSERT (${columnNames.map((name) => `[${name}]`).join(', ')})`,
      `VALUES (${columnNames.map((name) => `source.[${name}]`).join(', ')});`,
      'GO',
      ''
    ].filter(Boolean)

    return mergeSql.join('\n')
  }).join('\n')
}

async function fetchTableRows(client, config) {
  const rows = []
  let lastValue = null

  while (true) {
    let query = client
      .from(config.table)
      .select('*')
      .order(config.orderBy, { ascending: true })
      .limit(env.batchSize)

    if (lastValue !== null && config.primaryKey) {
      query = query.gt(config.primaryKey, lastValue)
    }

    const { data, error } = await query
    if (error) {
      throw new Error(`Khong doc duoc bang ${config.table}: ${error.message}`)
    }

    if (!data?.length) break
    rows.push(...data.map((row) => canonicalizeRow(row, config.schema)))
    if (data.length < env.batchSize) break
    lastValue = data[data.length - 1][config.primaryKey]
  }

  return rows
}

async function ensureOutputDir() {
  await fs.mkdir(outputDir, { recursive: true })
}

async function writeJson(tableName, rows) {
  const filePath = path.join(outputDir, `${tableName}.json`)
  await fs.writeFile(filePath, JSON.stringify(rows, null, 2), 'utf8')
  return filePath
}

async function writeSqlPackage(packageInfo) {
  const sqlParts = [
    '-- Auto-generated from Supabase export. This script only writes to local SQL Server.',
    'SET NOCOUNT ON;',
    'GO',
    ''
  ]

  for (const item of packageInfo) {
    sqlParts.push(createTableSql(item.table, item.columns, item.primaryKey))
    sqlParts.push(createMergeSql(item.table, item.columns, item.primaryKey, item.rows))
  }

  const sqlPath = path.join(outputDir, 'import-sqlserver.sql')
  await fs.writeFile(sqlPath, sqlParts.join('\n'), 'utf8')
  return sqlPath
}

async function writeReport(report) {
  const reportPath = path.join(outputDir, 'migration-report.json')
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
  return reportPath
}

async function buildClient() {
  const client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })

  if (env.supabaseEmail && env.supabasePassword) {
    const { error } = await client.auth.signInWithPassword({
      email: env.supabaseEmail,
      password: env.supabasePassword
    })
    if (error) {
      throw new Error(`Dang nhap Supabase that bai: ${error.message}`)
    }
  }

  return client
}

async function main() {
  await ensureOutputDir()
  const client = await buildClient()
  const packageInfo = []
  const report = {
    exportedAt: new Date().toISOString(),
    supabaseUrl: env.supabaseUrl,
    tables: []
  }

  for (const config of tableConfigs) {
    const rows = await fetchTableRows(client, config)
    const columns = collectColumns(rows, config.schema)
    const jsonPath = await writeJson(config.table, rows)

    packageInfo.push({
      table: config.table,
      primaryKey: config.primaryKey,
      columns,
      rows
    })

    report.tables.push({
      table: config.table,
      rowCount: rows.length,
      jsonPath
    })
  }

  const sqlPath = await writeSqlPackage(packageInfo)
  const reportPath = await writeReport(report)

  console.log(`Da xuat du lieu vao: ${outputDir}`)
  console.log(`File import SQL Server: ${sqlPath}`)
  console.log(`Bao cao: ${reportPath}`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
