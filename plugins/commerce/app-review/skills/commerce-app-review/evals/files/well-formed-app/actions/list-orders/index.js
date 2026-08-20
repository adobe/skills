/*
 * Copyright 2026 Acme Commerce Solutions. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import aioLogger from '@adobe/aio-lib-core-logging'
import { badRequest, internalServerError, ok } from '@adobe/aio-commerce-lib-core/responses'
import { AssociationRecordNotFoundError, getCommerceClient } from '@adobe/aio-commerce-lib-app'
import { resolveImsAuthParams } from '@adobe/aio-commerce-lib-auth'

const DEFAULT_PAGE_SIZE = 20

function resolvePageSize (rawPageSize) {
  if (rawPageSize == null) return DEFAULT_PAGE_SIZE
  const pageSize = Number(rawPageSize)
  return Number.isInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE
}

export async function main (params) {
  const logger = aioLogger('main', { level: params.LOG_LEVEL || 'info' })
  const pageSize = resolvePageSize(params.pageSize)

  try {
    const client = await getCommerceClient(resolveImsAuthParams(params))
    const result = await client.get('V1/orders', {
      searchParams: { 'searchCriteria[pageSize]': String(pageSize) },
    }).json()
    return ok({ body: { orders: result.items || [] } })
  } catch (error) {
    if (error instanceof AssociationRecordNotFoundError) {
      return badRequest({ body: { message: 'App is not associated with a Commerce instance.' } })
    }
    logger.error(error)
    return internalServerError({ body: { message: 'Order list lookup failed' } })
  }
}
