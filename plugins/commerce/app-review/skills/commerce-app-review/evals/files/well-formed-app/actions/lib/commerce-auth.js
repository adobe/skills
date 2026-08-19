/*
 * Copyright 2026 Adobe. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { AdobeCommerceHttpClient, resolveCommerceHttpClientParams } = require('@adobe/aio-commerce-lib-api')
const { initialize, getConfiguration, byCodeAndLevel } = require('@adobe/aio-commerce-lib-config')
const schema = require('../../src/commerce-configuration-1/.generated/configuration-schema.json')

async function loadConfig (params) {
    initialize({ schema })
    const options = params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY
        ? { encryptionKey: params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY }
        : {}
    const { config } = await getConfiguration(byCodeAndLevel('global', 'global'), options)
    const cfg = {}
    for (const item of config) {
        if (item.value != null && item.value !== '') cfg[item.name] = item.value
    }
    return cfg
}

/**
 * Builds a ready-to-use Commerce HTTP client for either flavor, using the
 * canonical AIO_COMMERCE_* parameter names the SDK resolver actually reads
 * (confirmed — starter-kit-style OAUTH_ and COMMERCE_ names are NOT consumed
 * directly by resolveCommerceHttpClientParams without mapping).
 */
function getCommerceClient (cfg) {
    const commerceParams = {
        AIO_COMMERCE_API_BASE_URL: cfg.commerceBaseUrl,
        AIO_COMMERCE_API_FLAVOR: cfg.oauthClientId ? 'saas' : 'paas',
        AIO_COMMERCE_AUTH_IMS_CLIENT_ID: cfg.oauthClientId,
        AIO_COMMERCE_AUTH_IMS_CLIENT_SECRETS: cfg.oauthClientSecrets,
        AIO_COMMERCE_AUTH_IMS_TECHNICAL_ACCOUNT_ID: cfg.oauthTechnicalAccountId,
        AIO_COMMERCE_AUTH_IMS_TECHNICAL_ACCOUNT_EMAIL: cfg.oauthTechnicalAccountEmail,
        AIO_COMMERCE_AUTH_IMS_ORG_ID: cfg.oauthImsOrgId,
        AIO_COMMERCE_AUTH_IMS_SCOPES: cfg.oauthScopes,
        AIO_COMMERCE_AUTH_INTEGRATION_CONSUMER_KEY: cfg.commerceConsumerKey,
        AIO_COMMERCE_AUTH_INTEGRATION_CONSUMER_SECRET: cfg.commerceConsumerSecret,
        AIO_COMMERCE_AUTH_INTEGRATION_ACCESS_TOKEN: cfg.commerceAccessToken,
        AIO_COMMERCE_AUTH_INTEGRATION_ACCESS_TOKEN_SECRET: cfg.commerceAccessTokenSecret,
    }

    const clientParams = resolveCommerceHttpClientParams(commerceParams)
    return new AdobeCommerceHttpClient(clientParams)
}

module.exports = { loadConfig, getCommerceClient }
