export function EastmanPageMock() {
  return (
    <div className="site-mock" aria-hidden="true">
      <div className="site-accent" />
      <header className="site-header">
        <div className="eastman-wordmark">EASTMAN</div>
        <div className="site-utilities">
          <span>Search</span>
          <span>Products</span>
          <span>Login</span>
          <span className="site-menu">Menu</span>
        </div>
      </header>

      <div className="site-product-nav">
        <strong>Products</strong>
        <div>
          <span>Product finder</span>
          <span>Markets</span>
          <span>Brands</span>
          <span>Product types</span>
        </div>
      </div>

      <div className="site-breadcrumb">Home&nbsp;&nbsp;/&nbsp;&nbsp;Products&nbsp;&nbsp;/&nbsp;&nbsp;<strong>Product finder</strong></div>

      <section className="site-hero">
        <h1>Find a product</h1>
        <div className="site-search">
          <span>Search by product name or application</span>
          <span className="site-search-button">Search</span>
        </div>
      </section>

      <div className="site-results">
        <aside className="site-filters">
          <div><strong>Markets</strong><span>+</span></div>
          <div><strong>Product types</strong><span>+</span></div>
          <div><strong>Brands</strong><span>+</span></div>
          <div><strong>Applications</strong><span>+</span></div>
        </aside>
        <div className="site-list">
          <div className="site-result-meta"><strong>979 Results</strong><span>Share results</span></div>
          <article className="site-result-card">
            <div>
              <h2>Eastman products</h2>
              <p>Explore specialty materials and solutions for your application.</p>
            </div>
            <span>→</span>
          </article>
          <article className="site-result-card site-result-card--muted">
            <div>
              <h2>Technical product information</h2>
              <p>Review product details, documents, and support resources.</p>
            </div>
            <span>→</span>
          </article>
        </div>
      </div>
    </div>
  )
}
