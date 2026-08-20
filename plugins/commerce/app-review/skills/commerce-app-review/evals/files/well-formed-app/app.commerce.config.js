/*
 * Copyright 2026 Acme Commerce Solutions. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from '@adobe/aio-commerce-lib-app/config'

export default defineConfig({
  metadata: {
    id: 'order-status',
    displayName: 'Order Status',
    description: 'Look up order status via the Commerce REST API.',
    version: '1.0.0'
  }
})
