/*
 * Copyright 2026 Acme Commerce Solutions. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import aioLogger from '@adobe/aio-lib-core-logging'
import { badRequest, internalServerError, ok } from '@adobe/aio-commerce-lib-core/responses'
import { AssociationRecordNotFoundError, getCommerceClient } from '@adobe/aio-commerce-lib-app'
import { resolveImsAuthParams } from '@adobe/aio-commerce-lib-auth'

const VALID_ORDER_ID = /^[A-Za-z0-9-]+$/

export async function main (params) {
  const logger = aioLogger('main', { level: params.LOG_LEVEL || 'info' })

  if (!params.orderId) {
    return badRequest({ body: { message: 'orderId is required' } })
  }

  if (!VALID_ORDER_ID.test(params.orderId)) {
    return badRequest({ body: { message: 'orderId must be alphanumeric' } })
  }

  try {
    const client = await getCommerceClient(resolveImsAuthParams(params))
    const order = await client.get(`V1/orders/${encodeURIComponent(params.orderId)}`).json()
    return ok({ body: { orderId: params.orderId, status: order.status } })
  } catch (error) {
    if (error instanceof AssociationRecordNotFoundError) {
      return badRequest({ body: { message: 'App is not associated with a Commerce instance.' } })
    }
    logger.error(error)
    return internalServerError({ body: { message: 'Order lookup failed' } })
  }
}
