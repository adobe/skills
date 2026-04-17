# Generic CI/CD Pipeline Guide (Non-GitHub)

Patterns for Azure DevOps, GitLab CI, and Jenkins. All use the same underlying approach: install the aio CLI, configure workspace credentials, then run `aio app deploy`.

Source: [Adobe CI/CD Documentation](https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/deployment/cicd-using-github-actions)

## Universal Pattern

For any CI/CD platform that is not GitHub Actions:

1. **Download **`workspace.json` from Adobe Developer Console (Workspace overview → Download all)
2. **Run **`aio app use <workspace.json>` locally to generate `.aio` and `.env` files
3. **Store **`.aio`** and **`.env`** contents** as CI secrets (or individual values)
4. **In the pipeline:** Recreate `.aio` and `.env` from secrets, then run `aio app deploy`

### Prerequisites (all platforms)

- Node.js 18+ installed in the CI environment
- `@adobe/aio-cli` installed globally (`npm install -g @adobe/aio-cli`)
- "I/O Management API" added to the target workspace in Developer Console
- OAuth S2S credential present in the workspace

## Azure DevOps

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'
    displayName: 'Install Node.js'

  - script: npm install -g @adobe/aio-cli
    displayName: 'Install aio CLI'

  - script: |
      echo '$(AIO_CONFIG)' > .aio
      echo '$(ENV_CONFIG)' > .env
    displayName: 'Write workspace config from secrets'

  - script: npm install
    displayName: 'Install dependencies'

  - script: aio app build
    displayName: 'Build application'

  - script: aio app deploy --no-publish
    displayName: 'Deploy to workspace'
```

**Secret setup in Azure DevOps:**

- Go to Pipelines → Library → Variable groups
- Store `AIO_CONFIG` (contents of `.aio`) and `ENV_CONFIG` (contents of `.env`) as secret variables
- Alternatively, store individual secret values and reconstruct files in a script step

## GitLab CI

```yaml
# .gitlab-ci.yml
image: node:20

stages:
  - build
  - test
  - deploy

variables:
  NODE_ENV: production

before_script:
  - npm install -g @adobe/aio-cli
  - echo "$AIO_CONFIG" > .aio
  - echo "$ENV_CONFIG" > .env
  - npm install

build:
  stage: build
  script:
    - aio app build

test:
  stage: test
  script:
    - aio app test

deploy_stage:
  stage: deploy
  script:
    - aio app deploy --no-publish
  only:
    - main

deploy_prod:
  stage: deploy
  script:
    - aio app deploy --no-publish
  only:
    - tags
  when: manual
```

**Secret setup in GitLab:**

- Go to Settings → CI/CD → Variables
- Add `AIO_CONFIG` and `ENV_CONFIG` as masked, protected variables
- Mark as "Protected" to restrict to protected branches only

## Jenkins

```groovy
// Jenkinsfile
pipeline {
    agent {
        docker { image 'node:20' }
    }
    environment {
        AIO_CONFIG = credentials('aio-config')
        ENV_CONFIG = credentials('env-config')
    }
    stages {
        stage('Setup') {
            steps {
                sh 'npm install -g @adobe/aio-cli'
                sh 'echo "$AIO_CONFIG" > .aio'
                sh 'echo "$ENV_CONFIG" > .env'
                sh 'npm install'
            }
        }
        stage('Build') {
            steps { sh 'aio app build' }
        }
        stage('Test') {
            steps { sh 'aio app test' }
        }
        stage('Deploy') {
            when { branch 'main' }
            steps { sh 'aio app deploy --no-publish' }
        }
    }
}
```

**Secret setup in Jenkins:**

- Go to Manage Jenkins → Credentials
- Add `aio-config` and `env-config` as "Secret text" credentials
- Scope to the specific pipeline or folder

## Security Considerations

- **Never commit **`.aio`** or **`.env`** files** to version control — they contain credentials
- **Rotate credentials** when team members leave or credentials are compromised
- **Use protected branches/environments** in CI to restrict who can trigger deploys
- **Audit secret access** regularly in your CI platform's settings
- **Workspace isolation:** Each workspace (Stage, Prod) should have its own credential set