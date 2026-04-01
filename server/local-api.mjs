import cors from 'cors'
import express from 'express'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { del as deleteBlob, put as putBlob } from '@vercel/blob'
import mssql from 'mssql'
import { v4 as uuidv4 } from 'uuid'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const mediaRoot = path.join(projectRoot, 'local-media')
const upload = multer({ storage: multer.memoryStorage() })

const PORT = Number(process.env.LOCAL_API_PORT || 3030)
const DEFAULT_PASSWORD = process.env.LOCAL_DEFAULT_PASSWORD || '123456'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7
const SESSION_SECRET = process.env.API_SESSION_SECRET || process.env.LOCAL_API_SESSION_SECRET || 'local-dev-session-secret'
const STORAGE_BACKEND = (process.env.STORAGE_BACKEND || '').trim().toLowerCase()
const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN)
const useVercelBlob = STORAGE_BACKEND === 'vercel-blob' || hasBlobToken

const sqlServerHost = process.env.SQLSERVER_HOST || process.env.COMPUTERNAME || 'DESKTOP-K6GPG8E'
const sqlServerDatabase = process.env.SQLSERVER_DATABASE || 'ASVN_Local'
const connectionString = process.env.SQLSERVER_CONNECTION_STRING || (
  process.env.SQLSERVER_USER && process.env.SQLSERVER_PASSWORD
    ? `Server=${sqlServerHost};Database=${sqlServerDatabase};User ID=${process.env.SQLSERVER_USER};Password=${process.env.SQLSERVER_PASSWORD};TrustServerCertificate=True;Encrypt=False;`
    : `Server=${sqlServerHost};Database=${sqlServerDatabase};Integrated Security=True;TrustServerCertificate=True;Encrypt=False;`
)

const sql = mssql

const tableSchemas = {
  customers: {
    primaryKey: 'id',
    columns: {
      id: 'bigint',
      ticketId: 'nvarchar',
      name: 'nvarchar',
      phone: 'nvarchar',
      model: 'nvarchar',
      address: 'nvarchar',
      issue: 'nvarchar',
      status: 'int',
      replacedPart: 'nvarchar',
      doneDate: 'nvarchar',
      createdAt: 'datetime2',
      folderDrive: 'nvarchar',
      warehouse: 'nvarchar',
      serial: 'nvarchar',
      branch: 'nvarchar',
      note: 'nvarchar',
      statusLog: 'json',
      price: 'decimal',
      lkItems: 'json',
      warranty_months: 'int',
      warranty_start_at: 'datetime2',
      warranty_expires_at: 'datetime2',
      media: 'json',
    },
  },
  profiles: {
    primaryKey: 'id',
    columns: {
      id: 'uuid',
      email: 'nvarchar',
      phone: 'nvarchar',
      full_name: 'nvarchar',
      role: 'nvarchar',
      warehouse: 'nvarchar',
      is_active: 'bit',
      account_status: 'nvarchar',
      approval_note: 'nvarchar',
      approved_by: 'uuid',
      approved_at: 'datetime2',
      created_at: 'datetime2',
      updated_at: 'datetime2',
    },
  },
  customer_share_links: {
    primaryKey: 'id',
    columns: {
      id: 'bigint',
      customer_id: 'bigint',
      share_token: 'nvarchar',
      share_enabled: 'bit',
      public_payload: 'json',
      created_by: 'uuid',
      created_at: 'datetime2',
      updated_at: 'datetime2',
    },
  },
  local_auth_accounts: {
    primaryKey: 'id',
    columns: {
      id: 'uuid',
      email: 'nvarchar',
      password_hash: 'nvarchar',
      must_change_password: 'bit',
      created_at: 'datetime2',
      updated_at: 'datetime2',
    },
  },
}

function getSchema(tableName) {
  const schema = tableSchemas[tableName]
  if (!schema) throw new Error(`Bang khong duoc ho tro: ${tableName}`)
  return schema
}

function parseSelectColumns(rawColumns, tableName) {
  if (!rawColumns || rawColumns === '*') return Object.keys(getSchema(tableName).columns)
  return rawColumns
    .split(',')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((part) => part.replace(/^"|"$/g, ''))
}

function escapeIdentifier(identifier) {
  return `[${String(identifier).replace(/]/g, ']]')}]`
}

function nowIso() {
  return new Date().toISOString()
}

function isAbsoluteUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function createSessionToken(profile, expiresAt) {
  const payload = {
    sub: profile.id,
    email: profile.email,
    role: profile.role,
    exp: Math.floor(expiresAt / 1000),
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url')
  return `${encodedPayload}.${signature}`
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null
  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) return null

  const expectedSignature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url')

  if (signature.length !== expectedSignature.length) {
    return null
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload))
    if (!payload?.sub || !payload?.exp) return null
    if ((payload.exp * 1000) <= Date.now()) return null
    return payload
  } catch {
    return null
  }
}

function parseDotNetJsonDate(value) {
  if (typeof value !== 'string') return null
  const match = value.match(/^\/Date\((\-?\d+)(?:[+-]\d+)?\)\/$/)
  if (!match) return null
  const timestamp = Number(match[1])
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp)
}

function normalizeJsonValue(value) {
  if (value === null || value === undefined || value === '') return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return [] }
  }
  return value
}

function getRequestBaseUrl(req) {
  if (!req) return ''
  return `${req.protocol}://${req.get('host')}`
}

function buildStoredMediaUrl(storedPath, baseUrl = '', bucket = 'media') {
  if (!storedPath) return ''
  if (isAbsoluteUrl(storedPath)) return storedPath
  const normalizedPath = String(storedPath).replace(/^\/+/, '')
  return baseUrl ? `${baseUrl}/media/${bucket}/${normalizedPath}` : `/media/${bucket}/${normalizedPath}`
}

function buildPublicMediaItems(customer, baseUrl = '') {
  const rawMedia = normalizeJsonValue(customer?.media)
  return rawMedia.map((mediaItem) => {
    if (!mediaItem) return null

    if (mediaItem?.source === 'storage' && mediaItem?.path) {
      return {
        type: mediaItem.type || 'image',
        source: 'storage',
        path: mediaItem.path,
        data: buildStoredMediaUrl(mediaItem.path, baseUrl, 'media'),
      }
    }

    if (mediaItem?.source === 'drive') {
      return {
        type: mediaItem.type || 'image',
        source: 'drive',
        data: mediaItem.data || mediaItem.original || '',
      }
    }

    if (mediaItem?.data) {
      return {
        type: mediaItem.type || 'image',
        source: mediaItem.source || 'local',
        data: mediaItem.data,
      }
    }

    return null
  }).filter(Boolean)
}

function buildCustomerSharePayload(customer, options = {}) {
  if (!customer) return {}
  const expiresAt = customer.warranty_expires_at ? new Date(customer.warranty_expires_at) : null
  const now = new Date()
  const baseUrl = options.baseUrl || ''
  const address = !customer.address || customer.address === 'Ca ngoài - không có địa chỉ'
    ? null
    : customer.address

  return {
    id: customer.id,
    ticketId: customer.ticketId,
    name: customer.name,
    phone: customer.phone,
    model: customer.model,
    address,
    issue: customer.issue,
    note: customer.note || '',
    serial: customer.serial,
    replacedPart: customer.replacedPart,
    price: customer.price,
    lkItems: normalizeJsonValue(customer.lkItems),
    media: buildPublicMediaItems(customer, baseUrl),
    status: customer.status ?? 0,
    doneDate: customer.doneDate,
    createdAt: customer.createdAt,
    warranty_label: customer.warranty_months > 0 ? `Bao hanh ${customer.warranty_months} thang` : null,
    warranty_start_at: customer.warranty_start_at,
    warranty_expires_at: customer.warranty_expires_at,
    warranty_remaining_text: !expiresAt ? null : expiresAt < now ? 'Het bao hanh' : 'Con hieu luc',
  }
}

function coerceInputValue(tableName, columnName, value) {
  const kind = getSchema(tableName).columns[columnName]
  if (value === undefined || value === null) return null
  if (kind === 'json') return typeof value === 'string' ? value : JSON.stringify(value)
  if (kind === 'bit') return value ? 1 : 0
  if (kind === 'int' || kind === 'bigint') return value === '' ? null : Number(value)
  if (kind === 'decimal') return value === '' ? null : Number(value)
  if (kind === 'datetime2') return value ? new Date(value) : null
  return value
}

function parseOutputValue(tableName, columnName, value) {
  const kind = getSchema(tableName).columns[columnName]
  if (value === null || value === undefined) return null
  if (kind === 'json') {
    if (typeof value !== 'string') return value
    try { return JSON.parse(value) } catch { return value }
  }
  if (kind === 'bit') return Boolean(value)
  if (kind === 'datetime2') {
    const date = value instanceof Date ? value : (parseDotNetJsonDate(value) || new Date(value))
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  if (typeof value === 'bigint') return Number(value)
  return value
}

function rowToObject(tableName, row) {
  const output = {}
  for (const column of Object.keys(row)) {
    output[column] = parseOutputValue(tableName, column, row[column])
  }
  return output
}

function addInput(request, name, typeName, value) {
  const resolvedValue = value === undefined ? null : value
  if (value === null || value === undefined) {
  }
  switch (typeName) {
    case 'bigint':
      request.input(name, sql.BigInt, resolvedValue === null ? null : Number(resolvedValue))
      return
    case 'int':
      request.input(name, sql.Int, resolvedValue === null ? null : Number(resolvedValue))
      return
    case 'decimal':
      request.input(name, sql.Decimal(18, 2), resolvedValue === null ? null : Number(resolvedValue))
      return
    case 'bit':
      request.input(name, sql.Bit, resolvedValue === null ? null : Boolean(resolvedValue))
      return
    case 'uuid':
      request.input(name, sql.UniqueIdentifier, resolvedValue === null ? null : String(resolvedValue))
      return
    case 'datetime2':
      request.input(name, sql.DateTime2, resolvedValue === null ? null : (resolvedValue instanceof Date ? resolvedValue : new Date(resolvedValue)))
      return
    default:
      request.input(name, sql.NVarChar(sql.MAX), resolvedValue === null ? null : String(resolvedValue))
  }
}

function applyFilterClauses({ tableName, filters = [], request, startingIndex = 0 }) {
  const clauses = []
  const schema = getSchema(tableName)
  let index = startingIndex

  for (const filter of filters) {
    const columnName = filter.column
    if (!schema.columns[columnName]) continue
    const paramName = `p${index++}`
    const escapedColumn = escapeIdentifier(columnName)
    const kind = schema.columns[columnName]

    if (filter.type === 'eq') {
      addInput(request, paramName, kind, coerceInputValue(tableName, columnName, filter.value))
      clauses.push(`${escapedColumn} = @${paramName}`)
      continue
    }
    if (filter.type === 'gt') {
      addInput(request, paramName, kind, coerceInputValue(tableName, columnName, filter.value))
      clauses.push(`${escapedColumn} > @${paramName}`)
      continue
    }
    if (filter.type === 'not' && filter.operator === 'is' && filter.value === null) {
      clauses.push(`${escapedColumn} IS NOT NULL`)
    }
  }

  return { whereSql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', nextIndex: index }
}

async function ensureSchema(pool) {
  await pool.request().query(`
    IF COL_LENGTH('dbo.profiles', 'phone') IS NULL
    BEGIN
      ALTER TABLE dbo.profiles
      ADD [phone] NVARCHAR(50) NULL;
    END

    IF COL_LENGTH('dbo.profiles', 'account_status') IS NULL
    BEGIN
      ALTER TABLE dbo.profiles
      ADD [account_status] NVARCHAR(50) NULL;
    END

    IF COL_LENGTH('dbo.profiles', 'approval_note') IS NULL
    BEGIN
      ALTER TABLE dbo.profiles
      ADD [approval_note] NVARCHAR(500) NULL;
    END

    IF COL_LENGTH('dbo.profiles', 'approved_by') IS NULL
    BEGIN
      ALTER TABLE dbo.profiles
      ADD [approved_by] UNIQUEIDENTIFIER NULL;
    END

    IF COL_LENGTH('dbo.profiles', 'approved_at') IS NULL
    BEGIN
      ALTER TABLE dbo.profiles
      ADD [approved_at] DATETIME2 NULL;
    END

    UPDATE dbo.profiles
    SET is_active = 1
    WHERE is_active IS NULL;

    UPDATE dbo.profiles
    SET account_status = 'approved'
    WHERE account_status IS NULL;

    IF COL_LENGTH('dbo.customers', 'note') IS NULL
    BEGIN
      ALTER TABLE dbo.customers
      ADD [note] NVARCHAR(MAX) NULL;
    END

    IF OBJECT_ID(N'dbo.local_auth_accounts', N'U') IS NULL
    BEGIN
      CREATE TABLE [dbo].[local_auth_accounts] (
        [id] UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
        [email] NVARCHAR(255) NOT NULL UNIQUE,
        [password_hash] NVARCHAR(255) NOT NULL,
        [must_change_password] BIT NOT NULL DEFAULT 1,
        [created_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        [updated_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `)

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10)
  await pool.request()
    .input('passwordHash', sql.NVarChar(sql.MAX), passwordHash)
    .query(`
      INSERT INTO dbo.local_auth_accounts (id, email, password_hash, must_change_password, created_at, updated_at)
      SELECT p.id, p.email, @passwordHash, 1, SYSUTCDATETIME(), SYSUTCDATETIME()
      FROM dbo.profiles p
      LEFT JOIN dbo.local_auth_accounts a ON a.id = p.id
      WHERE a.id IS NULL
        AND p.email IS NOT NULL
    `)
}

async function getPool() {
  if (!globalThis.__asvnLocalPool) {
    globalThis.__asvnLocalPool = await new sql.ConnectionPool(connectionString).connect()
    await ensureSchema(globalThis.__asvnLocalPool)
  }
  return globalThis.__asvnLocalPool
}

function makeSessionPayload(profile) {
  return {
    user: {
      id: profile.id,
      email: profile.email,
      user_metadata: {
        full_name: profile.full_name,
        role: profile.role,
      },
    },
    access_token: '',
    refresh_token: '',
    expires_at: Math.floor((Date.now() + SESSION_TTL_MS) / 1000),
  }
}

async function loadProfileById(pool, id) {
  const result = await pool.request()
    .input('id', sql.UniqueIdentifier, id)
    .query(`
      SELECT TOP 1 [id], [email], [phone], [full_name], [role], [warehouse], [is_active], [account_status], [approval_note], [approved_by], [approved_at], [created_at], [updated_at]
      FROM dbo.profiles
      WHERE id = @id
    `)
  const row = result.recordset[0]
  return row ? rowToObject('profiles', row) : null
}

async function getNextBigIntId(pool, tableName) {
  const primaryKey = getSchema(tableName).primaryKey
  const result = await pool.request().query(`
    SELECT ISNULL(MAX(${escapeIdentifier(primaryKey)}), 0) + 1 AS nextId
    FROM dbo.${escapeIdentifier(tableName).slice(1, -1)}
  `)
  return Number(result.recordset[0]?.nextId || 1)
}

async function enrichRowForWrite(pool, tableName, row, action = 'insert') {
  const enriched = { ...row }
  const schema = getSchema(tableName)
  const primaryKey = schema.primaryKey

  if ((tableName === 'customers' || tableName === 'customer_share_links') && (enriched[primaryKey] === null || enriched[primaryKey] === undefined)) {
    enriched[primaryKey] = await getNextBigIntId(pool, tableName)
  }

  if (tableName === 'customer_share_links') {
    if (!enriched.created_at) enriched.created_at = nowIso()
    enriched.updated_at = nowIso()
    if (enriched.share_enabled === undefined) enriched.share_enabled = true
  }

  if (tableName === 'profiles') {
    if (!enriched.created_at && action === 'insert') enriched.created_at = nowIso()
    if (!enriched.updated_at) enriched.updated_at = nowIso()
    if (!enriched.account_status && action === 'insert') enriched.account_status = 'approved'
  }

  return enriched
}

async function sessionFromRequest(req, _res, next) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  if (!token) {
    req.session = null
    next()
    return
  }

  const payload = verifySessionToken(token)
  if (!payload?.sub) {
    req.session = null
    next()
    return
  }

  try {
    const pool = await getPool()
    const profile = await loadProfileById(pool, payload.sub)
    if (!profile || profile.is_active === false || profile.account_status !== 'approved') {
      req.session = null
      next()
      return
    }

    req.session = {
      token,
      profile,
      session: {
        ...makeSessionPayload(profile),
        access_token: token,
        refresh_token: token,
        expires_at: payload.exp,
      },
      expiresAt: payload.exp * 1000,
    }
  } catch (error) {
    console.error('[session]', error)
    req.session = null
  }

  next()
}

function requireAdmin(req, res, next) {
  if (!req.session?.profile || String(req.session.profile.role || '').toLowerCase() !== 'admin') {
    res.status(403).json({ error: { message: 'Chi admin moi duoc dung tinh nang nay.' } })
    return
  }
  next()
}

async function executeSelect(pool, tableName, payload = {}) {
  const schema = getSchema(tableName)
  const request = pool.request()
  const columns = parseSelectColumns(payload.columns, tableName)
  const selectedSql = columns.map(escapeIdentifier).join(', ')
  const { whereSql } = applyFilterClauses({
    tableName,
    filters: payload.filters,
    request,
  })
  const effectiveOrderColumn = payload.order?.column && schema.columns[payload.order.column]
    ? payload.order.column
    : Number.isFinite(payload.limit) ? schema.primaryKey : null
  const orderSql = effectiveOrderColumn
    ? ` ORDER BY ${escapeIdentifier(effectiveOrderColumn)} ${payload.order?.ascending === false ? 'DESC' : 'ASC'}`
    : ''
  const limitSql = Number.isFinite(payload.limit) ? ` OFFSET 0 ROWS FETCH NEXT ${Number(payload.limit)} ROWS ONLY` : ''
  const sqlText = `SELECT ${selectedSql} FROM dbo.${escapeIdentifier(tableName).slice(1, -1)}${whereSql}${orderSql}${limitSql}`
  const result = await request.query(sqlText)
  return result.recordset.map((row) => rowToObject(tableName, row))
}

async function executeInsert(pool, tableName, payload = {}) {
  const rows = Array.isArray(payload.values) ? payload.values : []
  const schema = getSchema(tableName)
  const results = []

  for (const originalRow of rows) {
    const row = await enrichRowForWrite(pool, tableName, originalRow, 'insert')
    const request = pool.request()
    const columns = Object.keys(row).filter((column) => schema.columns[column])
    const paramColumns = columns.map((column, index) => {
      addInput(request, `v${index}`, schema.columns[column], coerceInputValue(tableName, column, row[column]))
      return `@v${index}`
    })
    const outputSql = payload.returning?.length
      ? ` OUTPUT ${payload.returning.map((column) => `INSERTED.${escapeIdentifier(column)}`).join(', ')}`
      : ''
    const sqlText = `
      INSERT INTO dbo.${escapeIdentifier(tableName).slice(1, -1)} (${columns.map(escapeIdentifier).join(', ')})
      ${outputSql}
      VALUES (${paramColumns.join(', ')})
    `
    const result = await request.query(sqlText)
    if (payload.returning?.length) {
      results.push(...result.recordset.map((record) => rowToObject(tableName, record)))
    }
  }

  return results
}

async function executeUpdate(pool, tableName, payload = {}) {
  const schema = getSchema(tableName)
  const request = pool.request()
  const rawValues = { ...(payload.values || {}) }
  if ((tableName === 'profiles' || tableName === 'customer_share_links') && !rawValues.updated_at) {
    rawValues.updated_at = nowIso()
  }
  const updates = Object.entries(rawValues).filter(([column]) => schema.columns[column])
  const setSql = updates.map(([column], index) => {
    addInput(request, `u${index}`, schema.columns[column], coerceInputValue(tableName, column, rawValues[column]))
    return `${escapeIdentifier(column)} = @u${index}`
  }).join(', ')

  const outputSql = payload.returning?.length
    ? ` OUTPUT ${payload.returning.map((column) => `INSERTED.${escapeIdentifier(column)}`).join(', ')}`
    : ''
  const { whereSql } = applyFilterClauses({
    tableName,
    filters: payload.filters,
    request,
    startingIndex: updates.length,
  })

  const sqlText = `UPDATE dbo.${escapeIdentifier(tableName).slice(1, -1)} SET ${setSql}${outputSql}${whereSql}`
  const result = await request.query(sqlText)
  return (result.recordset || []).map((row) => rowToObject(tableName, row))
}

async function executeDelete(pool, tableName, payload = {}) {
  const request = pool.request()
  const outputSql = payload.returning?.length
    ? ` OUTPUT ${payload.returning.map((column) => `DELETED.${escapeIdentifier(column)}`).join(', ')}`
    : ''
  const { whereSql } = applyFilterClauses({
    tableName,
    filters: payload.filters,
    request,
  })
  const sqlText = `DELETE FROM dbo.${escapeIdentifier(tableName).slice(1, -1)}${outputSql}${whereSql}`
  const result = await request.query(sqlText)
  return (result.recordset || []).map((row) => rowToObject(tableName, row))
}

async function executeUpsert(pool, tableName, payload = {}) {
  const schema = getSchema(tableName)
  const row = await enrichRowForWrite(pool, tableName, payload.values || {}, 'upsert')
  const conflictColumn = payload.onConflict || schema.primaryKey
  const columns = Object.keys(row).filter((column) => schema.columns[column])
  const request = pool.request()

  columns.forEach((column, index) => {
    addInput(request, `v${index}`, schema.columns[column], coerceInputValue(tableName, column, row[column]))
  })

  const sourceSql = columns.map((column, index) => `@v${index} AS ${escapeIdentifier(column)}`).join(', ')
  const updateSql = columns
    .filter((column) => column !== conflictColumn)
    .map((column) => `target.${escapeIdentifier(column)} = source.${escapeIdentifier(column)}`)
    .join(', ')
  const outputSql = payload.returning?.length
    ? payload.returning.map((column) => `INSERTED.${escapeIdentifier(column)}`).join(', ')
    : '*'
  const sqlText = `
    MERGE dbo.${escapeIdentifier(tableName).slice(1, -1)} AS target
    USING (SELECT ${sourceSql}) AS source
      ON target.${escapeIdentifier(conflictColumn)} = source.${escapeIdentifier(conflictColumn)}
    WHEN MATCHED THEN UPDATE SET ${updateSql || `target.${escapeIdentifier(conflictColumn)} = source.${escapeIdentifier(conflictColumn)}`}
    WHEN NOT MATCHED THEN INSERT (${columns.map(escapeIdentifier).join(', ')})
      VALUES (${columns.map((column) => `source.${escapeIdentifier(column)}`).join(', ')})
    OUTPUT ${outputSql};
  `
  const result = await request.query(sqlText)
  return (result.recordset || []).map((record) => rowToObject(tableName, record))
}

async function syncSharePayloadForCustomer(pool, customerId) {
  const customers = await executeSelect(pool, 'customers', {
    columns: '*',
    filters: [{ type: 'eq', column: 'id', value: customerId }],
  })
  const customer = customers[0]
  if (!customer) return

  const request = pool.request()
  request.input('customerId', sql.BigInt, Number(customerId))
  request.input('publicPayload', sql.NVarChar(sql.MAX), JSON.stringify(buildCustomerSharePayload(customer)))
  await request.query(`
    UPDATE dbo.customer_share_links
    SET public_payload = @publicPayload,
        updated_at = SYSUTCDATETIME()
    WHERE customer_id = @customerId
  `)
}

async function uploadToConfiguredStorage(bucket, relativePath, file) {
  const normalizedPath = String(relativePath || '').replace(/^\/+/, '')
  if (useVercelBlob) {
    const blob = await putBlob(`${bucket}/${normalizedPath}`, file.buffer, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: file.mimetype || undefined,
    })
    return { path: blob.url, url: blob.url }
  }

  const fullPath = path.join(mediaRoot, bucket, normalizedPath)
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, file.buffer)
  return { path: normalizedPath, url: buildStoredMediaUrl(normalizedPath, '', bucket) }
}

async function removeFromConfiguredStorage(bucket, storedPath) {
  if (!storedPath) return

  if (isAbsoluteUrl(storedPath) || useVercelBlob) {
    await deleteBlob(storedPath)
    return
  }

  const fullPath = path.join(mediaRoot, bucket, String(storedPath).replace(/^\/+/, ''))
  await fs.rm(fullPath, { force: true })
}

const app = express()
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin || '*'
  res.header('Access-Control-Allow-Origin', requestOrigin)
  res.header('Vary', 'Origin')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})
app.use(cors())
app.use(express.json({ limit: '25mb' }))
app.use('/media', express.static(mediaRoot))
app.use('/api/media', express.static(mediaRoot))
app.use(sessionFromRequest)

app.get('/api/health', async (_req, res) => {
  const pool = await getPool()
  const result = await pool.request().query('SELECT 1 AS ok')
  res.json({ ok: result.recordset[0]?.ok === 1 })
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) {
      res.status(400).json({ error: { message: 'Vui long nhap email va mat khau.' } })
      return
    }

    const pool = await getPool()
    const result = await pool.request()
      .input('email', sql.NVarChar(255), String(email).trim().toLowerCase())
      .query(`
        SELECT TOP 1
          p.id,
          p.email,
          p.phone,
          p.full_name,
          p.role,
          p.warehouse,
          p.is_active,
          p.account_status,
          p.approval_note,
          p.approved_by,
          p.approved_at,
          p.created_at,
          p.updated_at,
          a.password_hash,
          a.must_change_password
        FROM dbo.profiles p
        INNER JOIN dbo.local_auth_accounts a ON a.id = p.id
        WHERE LOWER(p.email) = @email
      `)

    const record = result.recordset[0]
    if (!record) {
      res.status(401).json({ error: { message: 'Invalid login credentials' } })
      return
    }

    const isMatch = await bcrypt.compare(password, record.password_hash)
    if (!isMatch) {
      res.status(401).json({ error: { message: 'Invalid login credentials' } })
      return
    }

    if (record.account_status === 'pending') {
      res.status(403).json({ error: { message: 'Dang ky thanh cong, vui long doi admin xac nhan tai khoan.' } })
      return
    }

    if (record.account_status === 'rejected') {
      const rejectionMessage = record.approval_note
        ? `Tai khoan cua ban da bi tu choi. ${record.approval_note}`
        : 'Tai khoan cua ban da bi tu choi.'
      res.status(403).json({ error: { message: rejectionMessage } })
      return
    }

    if (record.is_active === false) {
      res.status(403).json({ error: { message: 'Tai khoan cua ban da bi khoa, vui long lien he admin.' } })
      return
    }

    const profile = rowToObject('profiles', record)
    const expiresAt = Date.now() + SESSION_TTL_MS
    const token = createSessionToken(profile, expiresAt)
    res.json({
      data: {
        ...makeSessionPayload(profile),
        access_token: token,
        refresh_token: token,
        expires_at: Math.floor(expiresAt / 1000),
      },
    })
  } catch (error) {
    console.error('[auth/login]', error)
    res.status(500).json({ error: { message: error.message || 'Khong dang nhap duoc.' } })
  }
})

app.get('/api/auth/session', async (req, res) => {
  if (!req.session) {
    res.json({ data: { session: null } })
    return
  }
  req.session.expiresAt = Date.now() + SESSION_TTL_MS
  req.session.session.expires_at = Math.floor(req.session.expiresAt / 1000)
  res.json({ data: { session: req.session.session } })
})

app.post('/api/auth/logout', async (req, res) => {
  res.json({ data: { success: true } })
})

app.post('/api/auth/users', requireAdmin, async (req, res) => {
  try {
    const { email, password, options } = req.body || {}
    const fullName = options?.data?.full_name || ''
    const phone = options?.data?.phone || null
    const role = options?.data?.role || 'nhanvien'
    const warehouse = options?.data?.warehouse || null

    if (!email || !password) {
      res.status(400).json({ error: { message: 'Email va mat khau la bat buoc.' } })
      return
    }

    const pool = await getPool()
    const id = uuidv4()
    const passwordHash = await bcrypt.hash(String(password), 10)
    const request = pool.request()
    request.input('id', sql.UniqueIdentifier, id)
    request.input('email', sql.NVarChar(255), String(email).trim().toLowerCase())
    request.input('phone', sql.NVarChar(50), phone)
    request.input('fullName', sql.NVarChar(255), fullName)
    request.input('role', sql.NVarChar(50), role)
    request.input('warehouse', sql.NVarChar(255), warehouse)
    request.input('passwordHash', sql.NVarChar(sql.MAX), passwordHash)
    await request.query(`
      INSERT INTO dbo.profiles (id, email, phone, full_name, role, warehouse, is_active, account_status, approval_note, approved_at, created_at, updated_at)
      VALUES (@id, @email, @phone, @fullName, @role, @warehouse, 1, 'approved', NULL, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME());

      INSERT INTO dbo.local_auth_accounts (id, email, password_hash, must_change_password, created_at, updated_at)
      VALUES (@id, @email, @passwordHash, 0, SYSUTCDATETIME(), SYSUTCDATETIME());
    `)

    const profile = await loadProfileById(pool, id)
    res.json({ data: { user: { id, email: profile?.email, user_metadata: { full_name: profile?.full_name, role: profile?.role } } } })
  } catch (error) {
    console.error('[auth/users]', error)
    res.status(500).json({ error: { message: error.message || 'Khong tao duoc tai khoan local.' } })
  }
})

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, fullName, phone } = req.body || {}
    const normalizedEmail = String(email || '').trim().toLowerCase()
    const normalizedName = String(fullName || '').trim()
    const normalizedPhone = String(phone || '').trim()

    if (!normalizedEmail || !password || !normalizedName || !normalizedPhone) {
      res.status(400).json({ error: { message: 'Vui long nhap day du ho ten, so dien thoai, email va mat khau.' } })
      return
    }

    const pool = await getPool()
    const duplicateCheck = await pool.request()
      .input('email', sql.NVarChar(255), normalizedEmail)
      .query(`
        SELECT TOP 1 id
        FROM dbo.profiles
        WHERE LOWER(email) = @email
      `)

    if (duplicateCheck.recordset[0]) {
      res.status(409).json({ error: { message: 'Email nay da ton tai trong he thong.' } })
      return
    }

    const id = uuidv4()
    const passwordHash = await bcrypt.hash(String(password), 10)
    const request = pool.request()
    request.input('id', sql.UniqueIdentifier, id)
    request.input('email', sql.NVarChar(255), normalizedEmail)
    request.input('phone', sql.NVarChar(50), normalizedPhone)
    request.input('fullName', sql.NVarChar(255), normalizedName)
    request.input('passwordHash', sql.NVarChar(sql.MAX), passwordHash)
    await request.query(`
      INSERT INTO dbo.profiles (id, email, phone, full_name, role, warehouse, is_active, account_status, approval_note, approved_at, created_at, updated_at)
      VALUES (@id, @email, @phone, @fullName, 'nhanvien', NULL, 0, 'pending', N'Cho admin xac nhan', NULL, SYSUTCDATETIME(), SYSUTCDATETIME());

      INSERT INTO dbo.local_auth_accounts (id, email, password_hash, must_change_password, created_at, updated_at)
      VALUES (@id, @email, @passwordHash, 0, SYSUTCDATETIME(), SYSUTCDATETIME());
    `)

    res.json({
      data: {
        success: true,
        message: 'Dang ky thanh cong, vui long doi admin xac nhan tai khoan.',
      },
    })
  } catch (error) {
    console.error('[auth/register]', error)
    res.status(500).json({ error: { message: error.message || 'Khong dang ky duoc tai khoan.' } })
  }
})

app.post('/api/auth/registrations/:id/review', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { approved, note } = req.body || {}
    const approvalNote = String(note || '').trim() || (approved ? 'Da duoc admin xac nhan.' : 'Tai khoan cua ban da bi tu choi.')
    const pool = await getPool()
    const request = pool.request()
    request.input('id', sql.UniqueIdentifier, id)
    request.input('approvedBy', sql.UniqueIdentifier, req.session.profile.id)
    request.input('approvedAt', sql.DateTime2, new Date())
    request.input('approvalNote', sql.NVarChar(500), approvalNote)
    request.input('isActive', sql.Bit, approved ? 1 : 0)
    request.input('accountStatus', sql.NVarChar(50), approved ? 'approved' : 'rejected')
    await request.query(`
      UPDATE dbo.profiles
      SET is_active = @isActive,
          account_status = @accountStatus,
          approval_note = @approvalNote,
          approved_by = @approvedBy,
          approved_at = @approvedAt,
          updated_at = SYSUTCDATETIME()
      WHERE id = @id
    `)

    const profile = await loadProfileById(pool, id)
    res.json({ data: { profile } })
  } catch (error) {
    console.error('[auth/registrations/review]', error)
    res.status(500).json({ error: { message: error.message || 'Khong xu ly duoc yeu cau dang ky.' } })
  }
})

app.post('/api/storage/upload', upload.single('file'), async (req, res) => {
  try {
    const bucket = req.body.bucket || 'media'
    const relativePath = String(req.body.path || '').replace(/^\/+/, '')
    if (!req.file || !relativePath) {
      res.status(400).json({ error: { message: 'Thieu file hoac duong dan luu.' } })
      return
    }
    const stored = await uploadToConfiguredStorage(bucket, relativePath, req.file)
    res.json({ data: stored })
  } catch (error) {
    console.error('[storage/upload]', error)
    res.status(500).json({ error: { message: error.message || 'Khong upload duoc file local.' } })
  }
})

app.post('/api/storage/remove', async (req, res) => {
  try {
    const bucket = req.body.bucket || 'media'
    const paths = Array.isArray(req.body.paths) ? req.body.paths : []
    await Promise.all(paths.map(async (relativePath) => {
      await removeFromConfiguredStorage(bucket, String(relativePath || ''))
    }))
    res.json({ data: { removed: paths } })
  } catch (error) {
    console.error('[storage/remove]', error)
    res.status(500).json({ error: { message: error.message || 'Khong xoa duoc file local.' } })
  }
})

app.post('/api/rpc/get_public_customer_share', async (req, res) => {
  try {
    const token = String(req.body?.p_token || '').trim()
    if (!token) {
      res.json({ data: [] })
      return
    }

    const pool = await getPool()
    const request = pool.request()
    request.input('token', sql.NVarChar(255), token)
    const result = await request.query(`
      SELECT TOP 1 id, customer_id, share_token, share_enabled, public_payload, created_by, created_at, updated_at
      FROM dbo.customer_share_links
      WHERE share_enabled = 1 AND share_token = @token
    `)
    const row = result.recordset[0]
    if (!row) {
      res.json({ data: [] })
      return
    }

    const link = rowToObject('customer_share_links', row)
    const customers = await executeSelect(pool, 'customers', {
      columns: '*',
      filters: [{ type: 'eq', column: 'id', value: link.customer_id }],
    })
    const customer = customers[0]
    if (!customer) {
      res.json({ data: [] })
      return
    }

    res.json({
      data: [{
        public_payload: buildCustomerSharePayload(customer, { baseUrl: getRequestBaseUrl(req) }),
        updated_at: link.updated_at || customer.createdAt || null,
      }],
    })
  } catch (error) {
    console.error('[rpc/get_public_customer_share]', error)
    res.status(500).json({ error: { message: error.message || 'Khong doc duoc link chia se.' } })
  }
})

app.post('/api/db/:tableName', async (req, res) => {
  try {
    const { tableName } = req.params
    const action = req.body?.action || 'select'
    const pool = await getPool()
    let data = null

    if (action === 'select') {
      data = await executeSelect(pool, tableName, req.body)
    } else if (action === 'insert') {
      data = await executeInsert(pool, tableName, req.body)
      if (tableName === 'customers') {
        for (const row of req.body.values || []) {
          if (row?.id) await syncSharePayloadForCustomer(pool, row.id)
        }
      }
    } else if (action === 'update') {
      data = await executeUpdate(pool, tableName, req.body)
      if (tableName === 'customers') {
        for (const row of data) {
          if (row?.id) await syncSharePayloadForCustomer(pool, row.id)
        }
      }
    } else if (action === 'delete') {
      data = await executeDelete(pool, tableName, req.body)
    } else if (action === 'upsert') {
      data = await executeUpsert(pool, tableName, req.body)
      if (tableName === 'customer_share_links') {
        for (const row of data) {
          const customers = await executeSelect(pool, 'customers', {
            columns: '*',
            filters: [{ type: 'eq', column: 'id', value: row.customer_id }],
          })
          const customer = customers[0]
          if (customer) {
            await executeUpdate(pool, 'customer_share_links', {
              values: {
                public_payload: buildCustomerSharePayload(customer),
                updated_at: nowIso(),
              },
              filters: [{ type: 'eq', column: 'id', value: row.id }],
            })
          }
        }
      }
    } else {
      throw new Error(`Action khong ho tro: ${action}`)
    }

    if (req.body.single) {
      if (!data[0]) throw new Error('Khong tim thay ban ghi.')
      res.json({ data: data[0], error: null })
      return
    }
    if (req.body.maybeSingle) {
      res.json({ data: data[0] || null, error: null })
      return
    }

    res.json({ data, error: null })
  } catch (error) {
    console.error('[db]', error)
    res.status(500).json({ data: null, error: { message: error.message || 'Khong xu ly duoc du lieu local.' } })
  }
})

export async function startLocalApi() {
  await fs.mkdir(mediaRoot, { recursive: true })
  await getPool()
  return app.listen(PORT, () => {
    console.log(`Local API listening on http://localhost:${PORT}`)
    console.log(`Mac dinh dang nhap local cho tai khoan da migrate: password = ${DEFAULT_PASSWORD}`)
  })
}

export default app

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startLocalApi().catch((error) => {
    console.error('[startup]', error)
    process.exit(1)
  })
}
