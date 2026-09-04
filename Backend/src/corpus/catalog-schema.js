const { z } = require('zod')

const stringBoolean = z.enum(['true', 'false']).transform((value) => value === 'true')

const facetValueSchema = z
  .object({
    level: z.string(),
    name: z.string().min(1),
    count: z.coerce.number().int().nonnegative(),
    id: z.string().min(1),
    childs: z.array(z.unknown()),
    lookupName: z.string(),
    selected: stringBoolean,
    parentId: z.string(),
  })
  .passthrough()

const facetSchema = z
  .object({
    categoryTitle: z.string().min(1),
    categoryName: z.string().min(1),
    values: z.array(facetValueSchema),
  })
  .passthrough()

const productSchema = z
  .object({
    FGMN: z.string().regex(/^[A-Za-z0-9_-]+$/),
    DisplayName: z.string().min(1),
    SortName: z.string().min(1),
    DisplayTDS: stringBoolean,
    DisplaySDS: stringBoolean,
    DisplaySalesSpec: stringBoolean,
    ShortDescription: z.string(),
  })
  .passthrough()

const catalogSchema = z
  .object({
    productDetails: z
      .object({
        filters: z.array(facetSchema),
        products: z.array(productSchema),
        labels: z
          .object({
            totalCount: z.coerce.number().int().nonnegative(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough()
  .superRefine((catalog, context) => {
    const { labels, products } = catalog.productDetails
    if (labels.totalCount !== products.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['productDetails', 'labels', 'totalCount'],
        message: `Expected ${products.length} from the products array`,
      })
    }

    const identifiers = new Set()
    products.forEach((product, index) => {
      if (identifiers.has(product.FGMN)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['productDetails', 'products', index, 'FGMN'],
          message: `Duplicate FGMN: ${product.FGMN}`,
        })
      }
      identifiers.add(product.FGMN)
    })
  })

module.exports = { catalogSchema }

