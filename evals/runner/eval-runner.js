#!/usr/bin/env node

/**
 * Adobe Skills Evaluation Runner
 *
 * Executes eval test cases for Adobe skills and generates reports.
 * Follows the agentskills.io evaluation pattern.
 *
 * Usage:
 *   npm run eval -- --skill cloud-service/dispatcher/config-authoring
 *   npm run eval -- --skill 6.5-lts/dispatcher/config-authoring
 *   npm run eval -- --skill cloud-service/dispatcher/config-authoring --iteration 2
 */

import { program } from 'commander';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import Anthropic from '@anthropic-ai/sdk';

const WORKSPACE_DIR = 'evals-workspace';
const EVALS_DIR = 'evals/skills';

program
  .name('eval-runner')
  .description('Run skill evaluations')
  .option('-s, --skill <path>', 'Skill to evaluate (e.g., cloud-service/dispatcher/config-authoring)')
  .option('-i, --iteration <number>', 'Iteration number', '1')
  .option('--ci', 'CI mode: fail on assertion failures')
  .option('--no-baseline', 'Skip baseline (without_skill) runs')
  .parse();

const options = program.opts();

/**
 * Main entry point
 */
async function main() {
  console.log(chalk.bold.blue('\n🧪 Adobe Skills Evaluation Runner\n'));

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(chalk.red('❌ Error: ANTHROPIC_API_KEY environment variable not set'));
    console.log(chalk.gray('   Set it with: export ANTHROPIC_API_KEY=your-key-here'));
    process.exit(1);
  }

  const skillPath = options.skill;
  if (!skillPath) {
    console.error(chalk.red('❌ Error: --skill option is required'));
    console.log(chalk.gray('   Example: npm run eval -- --skill cloud-service/dispatcher/config-authoring'));
    process.exit(1);
  }

  const evalsConfigPath = join(EVALS_DIR, skillPath, 'evals.json');

  let evalsConfig;
  try {
    const content = await readFile(evalsConfigPath, 'utf-8');
    evalsConfig = JSON.parse(content);
  } catch (error) {
    console.error(chalk.red(`❌ Error: Could not read evals config at ${evalsConfigPath}`));
    console.error(chalk.gray(`   ${error.message}`));
    process.exit(1);
  }

  console.log(chalk.cyan(`📋 Skill: ${evalsConfig.skill_name}`));
  console.log(chalk.cyan(`🏷️  Variant: ${evalsConfig.skill_variant}`));
  console.log(chalk.cyan(`📁 Path: ${evalsConfig.skill_path}`));
  console.log(chalk.cyan(`🧪 Test cases: ${evalsConfig.evals.length}`));
  console.log(chalk.cyan(`🔄 Iteration: ${options.iteration}\n`));

  const results = {
    skill: evalsConfig.skill_name,
    variant: evalsConfig.skill_variant,
    iteration: parseInt(options.iteration),
    timestamp: new Date().toISOString(),
    test_cases: [],
    summary: {
      total: evalsConfig.evals.length,
      passed: 0,
      failed: 0,
      skipped: 0
    }
  };

  // Run each eval test case
  for (const evalCase of evalsConfig.evals) {
    console.log(chalk.bold(`\n━━━ Test Case ${evalCase.id}: ${evalCase.name} ━━━\n`));

    const spinner = ora(`Running test case ${evalCase.id}...`).start();

    try {
      const testResult = await runEvalCase(evalsConfig, evalCase, options);
      results.test_cases.push(testResult);

      if (testResult.status === 'passed') {
        results.summary.passed++;
        spinner.succeed(chalk.green(`Test case ${evalCase.id} passed (${testResult.assertions.passed}/${testResult.assertions.total} assertions)`));
      } else {
        results.summary.failed++;
        spinner.fail(chalk.red(`Test case ${evalCase.id} failed (${testResult.assertions.passed}/${testResult.assertions.total} assertions)`));
      }
    } catch (error) {
      results.summary.failed++;
      spinner.fail(chalk.red(`Test case ${evalCase.id} error: ${error.message}`));
      results.test_cases.push({
        id: evalCase.id,
        name: evalCase.name,
        status: 'error',
        error: error.message
      });
    }
  }

  // Print summary
  console.log(chalk.bold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  console.log(chalk.bold('📊 Evaluation Summary\n'));
  console.log(`Total:   ${results.summary.total}`);
  console.log(chalk.green(`Passed:  ${results.summary.passed}`));
  console.log(chalk.red(`Failed:  ${results.summary.failed}`));

  const passRate = (results.summary.passed / results.summary.total * 100).toFixed(1);
  console.log(chalk.bold(`\nPass rate: ${passRate}%\n`));

  // Save results
  const resultsDir = join(WORKSPACE_DIR, skillPath, `iteration-${options.iteration}`);
  await mkdir(resultsDir, { recursive: true });
  const resultsPath = join(resultsDir, 'results.json');
  await writeFile(resultsPath, JSON.stringify(results, null, 2));
  console.log(chalk.gray(`Results saved to: ${resultsPath}\n`));

  // Exit with error code in CI mode if any tests failed
  if (options.ci && results.summary.failed > 0) {
    process.exit(1);
  }
}

/**
 * Run a single eval test case
 */
async function runEvalCase(evalsConfig, evalCase, options) {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });

  console.log(chalk.gray(`  Prompt: ${evalCase.prompt}`));
  console.log(chalk.gray(`  Expected: ${evalCase.expected_output}\n`));

  // Build system prompt based on skill variant
  const variantContext = evalsConfig.skill_variant === 'cloud-service'
    ? 'You have access to detailed documentation about AEM Cloud Service dispatcher patterns, best practices, and cloud-specific requirements. Focus on immutable configs, CDN integration, and Cloud Manager validation.'
    : 'You have access to detailed documentation about AEM 6.5 LTS/AMS dispatcher patterns, best practices, and AMS-specific requirements. Focus on mutable configs, AMS load balancers, and traditional validation tools.';

  const systemPrompt = `You are an AI assistant with expertise in Adobe AEM Dispatcher configuration.
${variantContext}
Answer the user's question with specific, actionable dispatcher configuration.`;

  // Simulate with_skill run
  const withSkillResponse = await client.messages.create({
    model: 'claude-sonnet-4-5-20241022',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: evalCase.prompt
    }]
  });

  const withSkillOutput = withSkillResponse.content[0].text;
  const withSkillTokens = withSkillResponse.usage.input_tokens + withSkillResponse.usage.output_tokens;

  // Simulate without_skill run (baseline)
  let withoutSkillOutput = null;
  let withoutSkillTokens = 0;
  if (options.baseline !== false) {
    const withoutSkillResponse = await client.messages.create({
      model: 'claude-sonnet-4-5-20241022',
      max_tokens: 4096,
      system: 'You are a helpful AI assistant.',
      messages: [{
        role: 'user',
        content: evalCase.prompt
      }]
    });
    withoutSkillOutput = withoutSkillResponse.content[0].text;
    withoutSkillTokens = withoutSkillResponse.usage.input_tokens + withoutSkillResponse.usage.output_tokens;
  }

  // Grade assertions
  const assertionResults = await gradeAssertions(
    client,
    evalCase.assertions,
    withSkillOutput,
    evalCase.expected_output
  );

  const passedCount = assertionResults.filter(r => r.passed).length;
  const totalCount = assertionResults.length;

  return {
    id: evalCase.id,
    name: evalCase.name,
    status: passedCount === totalCount ? 'passed' : 'failed',
    assertions: {
      total: totalCount,
      passed: passedCount,
      failed: totalCount - passedCount,
      results: assertionResults
    },
    timing: {
      with_skill_tokens: withSkillTokens,
      without_skill_tokens: withoutSkillTokens
    },
    outputs: {
      with_skill: withSkillOutput,
      without_skill: withoutSkillOutput
    }
  };
}

/**
 * Grade assertions using LLM
 */
async function gradeAssertions(client, assertions, output, expectedOutput) {
  const results = [];

  for (const assertion of assertions) {
    const gradeResponse = await client.messages.create({
      model: 'claude-haiku-4-5-20241022',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are grading an AI assistant's output against a specific assertion.

ASSERTION: ${assertion}

EXPECTED OUTPUT: ${expectedOutput}

ACTUAL OUTPUT:
${output}

Evaluate whether the assertion is satisfied by the actual output.
Respond in JSON format:
{
  "passed": true/false,
  "evidence": "specific quote or reference from the output that supports your decision"
}

Be strict - require concrete evidence for a PASS. If the assertion says "includes X" and X is not clearly present, mark as FAIL.`
      }]
    });

    try {
      const gradeText = gradeResponse.content[0].text;
      // Extract JSON from the response (handles markdown code blocks)
      const jsonMatch = gradeText.match(/\{[\s\S]*\}/);
      const grade = jsonMatch ? JSON.parse(jsonMatch[0]) : { passed: false, evidence: 'Failed to parse grade' };

      results.push({
        assertion,
        passed: grade.passed,
        evidence: grade.evidence
      });
    } catch (error) {
      results.push({
        assertion,
        passed: false,
        evidence: `Grading error: ${error.message}`
      });
    }
  }

  return results;
}

main().catch(error => {
  console.error(chalk.red('\n❌ Fatal error:'), error);
  process.exit(1);
});
