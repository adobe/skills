/*
 * Copyright 2026 Adobe. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { Core } = require('@adobe/aio-sdk')
const { loadConfig, getCommerceClient } = require('../lib/commerce-auth')

const VALID_ORDER_ID = /^[A-Za-z0-9-]+$/

async function main (params) {
  const logger = Core.Logger('main', { level: params.LOG_LEVEL || 'info' })

  if (!params.orderId) {
    return { error: 'orderId is required', statusCode: 400 }
  }

  if (!VALID_ORDER_ID.test(params.orderId)) {
    return { error: 'orderId must be alphanumeric', statusCode: 400 }
  }

  const cfg = await loadConfig(params)
  const client = getCommerceClient(cfg)

  try {
    const order = await client.get(`V1/orders/${encodeURIComponent(params.orderId)}`).json()
    return { orderId: params.orderId, status: order.status }
  } catch (error) {
    logger.error(error)
    return { error: 'Order lookup failed', statusCode: 502 }
  }
}

module.exports = { main }
