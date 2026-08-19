/*
 * Copyright 2026 Adobe. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { Core } = require('@adobe/aio-sdk')
const { loadConfig, getCommerceClient } = require('../lib/commerce-auth')

const DEFAULT_PAGE_SIZE = 20

async function main (params) {
  const logger = Core.Logger('main', { level: params.LOG_LEVEL || 'info' })

  const cfg = await loadConfig(params)
  const client = getCommerceClient(cfg)
  const pageSize = Number(params.pageSize) || DEFAULT_PAGE_SIZE

  try {
    const result = await client.get('V1/orders', {
      searchParams: { 'searchCriteria[pageSize]': String(pageSize) },
    }).json()
    return { orders: result.items || [] }
  } catch (error) {
    logger.error(error)
    return { error: 'Order list lookup failed', statusCode: 502 }
  }
}

module.exports = { main }
