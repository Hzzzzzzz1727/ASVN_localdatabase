const SHARE_TABLE = 'customer_share_links'

const getHexToken = (bytes = 24) => {
  const values = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(values, value => value.toString(16).padStart(2, '0')).join('')
}

export const createShareToken = () => getHexToken(24)

export const getBaseAppUrl = () => {
  const path = location.pathname.endsWith('/')
    ? location.pathname
    : location.pathname.replace(/\/[^/]*$/, '/')
  return `${location.origin}${path}`
}

export const buildPublicShareUrl = (token) => `${getBaseAppUrl()}share.html?token=${encodeURIComponent(token)}`

export const buildShareAdminUrl = (customerId) => `${getBaseAppUrl()}share-admin.html?id=${encodeURIComponent(customerId)}`

export const normalizeShareRecord = (record) => {
  if (!record) return null
  return {
    ...record,
    publicUrl: buildPublicShareUrl(record.share_token),
  }
}

export const loadShareRecordByCustomerId = async (supabase, customerId) => {
  const { data, error } = await supabase
    .from(SHARE_TABLE)
    .select('id, customer_id, share_token, share_enabled, created_at, updated_at, created_by')
    .eq('customer_id', customerId)
    .maybeSingle()

  if (error) throw error
  return normalizeShareRecord(data)
}

export const ensureShareRecord = async (supabase, customerId, currentUserId, rotateToken = false) => {
  const existing = await loadShareRecordByCustomerId(supabase, customerId)
  const shareToken = rotateToken || !existing?.share_token ? createShareToken() : existing.share_token

  const payload = {
    customer_id: customerId,
    share_token: shareToken,
    share_enabled: true,
  }

  if (currentUserId) {
    payload.created_by = existing?.created_by || currentUserId
  }

  const { data, error } = await supabase
    .from(SHARE_TABLE)
    .upsert(payload, { onConflict: 'customer_id' })
    .select('id, customer_id, share_token, share_enabled, created_at, updated_at, created_by')
    .single()

  if (error) throw error
  return normalizeShareRecord(data)
}

export const disableShareRecord = async (supabase, customerId) => {
  const { data, error } = await supabase
    .from(SHARE_TABLE)
    .update({ share_enabled: false })
    .eq('customer_id', customerId)
    .select('id, customer_id, share_token, share_enabled, created_at, updated_at, created_by')
    .maybeSingle()

  if (error) throw error
  return normalizeShareRecord(data)
}

export const copyText = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('readonly', 'true')
  input.style.position = 'absolute'
  input.style.left = '-9999px'
  document.body.appendChild(input)
  input.select()
  document.execCommand('copy')
  document.body.removeChild(input)
}
