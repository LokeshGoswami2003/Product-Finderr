import { safeEastmanUrl } from '../protocol/links'

function ProductLink({ href, children, className }) {
  const safeUrl = safeEastmanUrl(href)
  if (!safeUrl) return null
  return (
    <a className={className} href={safeUrl} target="_blank" rel="noreferrer">
      {children}<span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

export function ProductCard({ product }) {
  const { documents = {}, links = {} } = product
  return (
    <section className="product-card" aria-label={`Recommended product: ${product.displayName}`}>
      <div className="product-card-heading">
        <span className="product-icon" aria-hidden="true">E</span>
        <div>
          <p className="product-label">Eastman product</p>
          <h3>{product.displayName}</h3>
          <p className="fgmn">FGMN {product.fgmn}</p>
        </div>
      </div>
      <nav aria-label={`${product.displayName} resources`}>
        <ProductLink className="product-primary-link" href={links.detail}>View product <span aria-hidden="true">↗</span></ProductLink>
        <div className="product-resource-links">
          {documents.hasTds && <ProductLink href={links.tds}>TDS</ProductLink>}
          {documents.hasSds && <ProductLink href={links.sds}>SDS</ProductLink>}
          {documents.hasSalesSpecification && (
            <ProductLink href={links.salesSpecification}>Sales specification</ProductLink>
          )}
          <ProductLink href={links.inquiry}>Contact Eastman</ProductLink>
        </div>
      </nav>
    </section>
  )
}
