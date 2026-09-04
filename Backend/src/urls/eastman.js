const ALLOWED_EASTMAN_HOSTS = new Set([
  'www.eastman.com',
  'productcatalog.eastman.com',
  'ws.eastman.com',
])

const GENERIC_INQUIRY_URL = 'https://www.eastman.com/en/contact-us/product-inquiry'

function validateEastmanUrl(value) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      ALLOWED_EASTMAN_HOSTS.has(url.hostname)
    )
  } catch {
    return false
  }
}

function assertEastmanUrl(value) {
  if (!validateEastmanUrl(value)) {
    throw new TypeError('URL must use HTTPS and an approved Eastman hostname')
  }

  return value
}

function requireIdentifier(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError(`${name} must contain only letters, numbers, underscores, or hyphens`)
  }

  return value
}

function requireSlug(value) {
  if (typeof value !== 'string' || value.trim() === '' || /[/?#]/.test(value)) {
    throw new TypeError('slug must be a non-empty URL path segment')
  }

  return value
}

function buildProductUrls({ fgmn, slug }) {
  const safeFgmn = encodeURIComponent(requireIdentifier(fgmn, 'fgmn'))
  const safeSlug = encodeURIComponent(requireSlug(slug))

  const withProductQuery = (baseUrl, productKey = 'product') => {
    const url = new URL(baseUrl)
    url.searchParams.set(productKey, fgmn)
    url.searchParams.set('pn', slug)
    return assertEastmanUrl(url.toString())
  }

  return {
    detail: assertEastmanUrl(
      `https://www.eastman.com/en/products/product-detail/${safeFgmn}/${safeSlug}`,
    ),
    tds: withProductQuery('https://productcatalog.eastman.com/tds/ProdDatasheet.aspx'),
    sds: withProductQuery(
      'https://ws.eastman.com/ProductCatalogApps/PageControllers/MSDSAll_PC.aspx',
      'Product',
    ),
    salesSpecification: assertEastmanUrl(
      `https://www.eastman.com/supplemental/salespecs/${safeFgmn}.pdf`,
    ),
    inquiry: withProductQuery(
      'https://www.eastman.com/content/eastman/corporate/us/en/contact-us/product-inquiry.html',
    ),
    genericInquiry: GENERIC_INQUIRY_URL,
  }
}

module.exports = {
  ALLOWED_EASTMAN_HOSTS,
  GENERIC_INQUIRY_URL,
  assertEastmanUrl,
  buildProductUrls,
  validateEastmanUrl,
}

