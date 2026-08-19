/*
 * Copyright 2026 Adobe. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { defineConfig } = require('@adobe/aio-commerce-lib-app/config')

module.exports = defineConfig({
  metadata: {
    id: 'order-status',
    displayName: 'Order Status',
    description: 'Look up order status via the Commerce REST/GraphQL API.',
    version: '1.0.0'
  },
  businessConfig: {
    schema: [
      {
        name: 'commerceBaseUrl',
        label: 'Commerce Base URL',
        type: 'url',
        default: '',
        description: 'SaaS: https://<region>.api.commerce.adobe.com/<tenantId>/ — PaaS/On-Premise: https://<store>/rest/default/'
      },
      {
        name: 'oauthClientId',
        label: 'IMS OAuth Client ID',
        type: 'text',
        default: '',
        description: 'SaaS only — Client ID from your Adobe Developer Console credential.'
      },
      {
        name: 'oauthClientSecrets',
        label: 'IMS OAuth Client Secrets',
        type: 'password',
        description: 'SaaS only — JSON array of client secrets.'
      },
      {
        name: 'oauthTechnicalAccountId',
        label: 'IMS Technical Account ID',
        type: 'text',
        default: '',
        description: 'SaaS only — Technical account ID from Adobe Developer Console.'
      },
      {
        name: 'oauthTechnicalAccountEmail',
        label: 'IMS Technical Account Email',
        type: 'text',
        default: '',
        description: 'SaaS only — Technical account email from Adobe Developer Console.'
      },
      {
        name: 'oauthImsOrgId',
        label: 'IMS Org ID',
        type: 'text',
        default: '',
        description: 'SaaS only — Adobe IMS Org ID.'
      },
      {
        name: 'oauthScopes',
        label: 'IMS OAuth Scopes',
        type: 'text',
        default: '[]',
        description: 'SaaS only — JSON array of OAuth scopes.'
      },
      {
        name: 'commerceConsumerKey',
        label: 'Commerce Consumer Key',
        type: 'password',
        description: 'PaaS/On-Premise only — Consumer key from your Commerce Integration.'
      },
      {
        name: 'commerceConsumerSecret',
        label: 'Commerce Consumer Secret',
        type: 'password',
        description: 'PaaS/On-Premise only — Consumer secret from your Commerce Integration.'
      },
      {
        name: 'commerceAccessToken',
        label: 'Commerce Access Token',
        type: 'password',
        description: 'PaaS/On-Premise only — Access token from your Commerce Integration.'
      },
      {
        name: 'commerceAccessTokenSecret',
        label: 'Commerce Access Token Secret',
        type: 'password',
        description: 'PaaS/On-Premise only — Access token secret from your Commerce Integration.'
      }
    ]
  }
})
