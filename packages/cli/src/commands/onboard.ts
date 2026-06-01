import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { CentralCore, GlobalSettingsStore, getDefaultCentralDbPath } from "@fusion/core";
import { resolveProject } from "../project-context.js";
import { runInit } from "./init.js";
import {
  createReadOnlyAuthFileStorage,
  mergeAuthStorageReads,
  wrapAuthStorageWithApiKeyProviders,
} from "./provider-auth.js";
import {
  getFusionAuthPath,
  getLegacyAuthPaths,
  getModelRegistryModelsPath,
} from "./auth-paths.js";

export interface OnboardOptions {
  force?: boolean;
  input?: NodeJS.ReadableStream;
}

const PROMPT_CANCELLED_ERROR = "Interactive prompt cancelled";

interface PromptChoiceOption {
  id: string;
  label: string;
}

interface PromptChoiceOptions {
  allowSkip?: boolean;
}

interface PromptSession {
  prompt(question: string, defaultValue?: string): Promise<string>;
  promptYesNo(question: string, defaultValue: boolean): Promise<boolean>;
  promptChoice(
    question: string,
    choices: PromptChoiceOption[],
    options?: PromptChoiceOptions,
  ): Promise<string | undefined>;
  close(): void;
}

function createPromptSession(input: NodeJS.ReadableStream = process.stdin): PromptSession {
  const rl = createInterface({ input, output: process.stdout });
  let settled = false;

  const cleanup = () => {
    if (settled) return;
    settled = true;
    process.removeListener("SIGINT", sigintHandler);
    rl.close();
  };

  const cancel = () => {
    cleanup();
    console.log("\n");
  };

  const sigintHandler = () => cancel();
  process.on("SIGINT", sigintHandler);

  const ask = (question: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const onClose = () => reject(new Error(PROMPT_CANCELLED_ERROR));
      rl.once("close", onClose);
      rl.question(question, (answer) => {
        rl.removeListener("close", onClose);
        resolve(answer.trim());
      });
    });

  const prompt = async (question: string, defaultValue?: string): Promise<string> => {
    while (true) {
      const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : "";
      const answer = await ask(`${question}${suffix}: `);
      if (answer === "" && defaultValue !== undefined) {
        return defaultValue;
      }
      if (answer !== "") {
        return answer;
      }
    }
  };

  const promptYesNo = async (question: string, defaultValue: boolean): Promise<boolean> => {
    const hint = defaultValue ? "Y/n" : "y/N";
    while (true) {
      const answer = (await ask(`${question} (${hint}): `)).toLowerCase();
      if (!answer) return defaultValue;
      if (answer === "y" || answer === "yes") return true;
      if (answer === "n" || answer === "no") return false;
      console.log("Please answer yes or no.");
    }
  };

  const promptChoice = async (
    question: string,
    choices: PromptChoiceOption[],
    options: PromptChoiceOptions = {},
  ): Promise<string | undefined> => {
    if (choices.length === 0) return undefined;
    const rendered = choices.map((choice, index) => `  ${index + 1}) ${choice.label}`);
    rendered.forEach((line) => console.log(line));
    if (options.allowSkip) {
      console.log(`  ${choices.length + 1}) Skip`);
    }

    while (true) {
      const answer = await ask(`${question}: `);
      const selected = parseInt(answer, 10);
      const upperBound = choices.length + (options.allowSkip ? 1 : 0);
      if (!Number.isNaN(selected) && selected >= 1 && selected <= upperBound) {
        if (options.allowSkip && selected === choices.length + 1) return undefined;
        return choices[selected - 1]?.id;
      }
      console.log(`Please select a number between 1 and ${upperBound}.`);
    }
  };

  return {
    prompt,
    promptYesNo,
    promptChoice,
    close: cleanup,
  };
}

function validateMaxConcurrent(input: string): number {
  const value = parseInt(input, 10);
  if (Number.isNaN(value) || value < 1 || value > 10) {
    throw new Error("maxConcurrent must be an integer between 1 and 10.");
  }
  return value;
}

export async function runOnboard(options: OnboardOptions = {}): Promise<void> {
  const globalSettingsStore = new GlobalSettingsStore();
  await globalSettingsStore.init();
  const settings = await globalSettingsStore.getSettings();

  if (settings.cliOnboardingCompletedAt && !options.force) {
    console.log("Onboarding already completed. Re-run with --force to run it again.");
    return;
  }

  const prompts = createPromptSession(options.input);

  try {
    const centralDbPath = getDefaultCentralDbPath();
    if (existsSync(centralDbPath)) {
      console.log(`✓ Central DB already exists: ${centralDbPath}`);
    } else {
      console.log(`Creating central DB: ${centralDbPath}`);
      const central = new CentralCore();
      await central.init();
      await central.close();
      console.log("✓ Central DB initialized");
    }

    const authStorage = AuthStorage.create(getFusionAuthPath());
    const supplementalAuthStorage = createReadOnlyAuthFileStorage(getLegacyAuthPaths());
    const mergedAuthStorage = mergeAuthStorageReads(authStorage, [supplementalAuthStorage]);
    const modelRegistry = ModelRegistry.create(mergedAuthStorage, getModelRegistryModelsPath());
    const providerAuth = wrapAuthStorageWithApiKeyProviders(mergedAuthStorage, modelRegistry);

    const apiProviders = providerAuth.getApiKeyProviders();
    if (apiProviders.length > 0) {
      console.log("\nAI provider setup:");
      const oauthProviders = new Set(providerAuth.getOAuthProviders().map((provider) => provider.id));
      const providerChoices = apiProviders.map((provider) => {
        const configured = providerAuth.hasApiKey(provider.id) || providerAuth.hasAuth(provider.id);
        const oauthHint = oauthProviders.has(provider.id) ? " (OAuth via fn dashboard)" : "";
        const configuredHint = configured ? " (already configured)" : "";
        return {
          id: provider.id,
          label: `${provider.name}${configuredHint}${oauthHint}`,
        };
      });

      const selectedProvider = await prompts.promptChoice("Select provider", providerChoices, {
        allowSkip: true,
      });

      if (selectedProvider) {
        if (oauthProviders.has(selectedProvider)) {
          console.log(`Provider ${selectedProvider} uses OAuth. Authenticate with: fn dashboard`);
        } else {
          const apiKey = await prompts.prompt("Enter API key");
          providerAuth.setApiKey(selectedProvider, apiKey);
          console.log(`✓ Stored API key for ${selectedProvider}`);
        }
      }
    }

    console.log("\nProject setup:");
    const shouldInit = await prompts.promptYesNo("Run fn init for this directory now?", true);
    if (shouldInit) {
      await runInit({});
    }

    console.log("\nCore settings:");
    const testMode = await prompts.promptYesNo("Enable test mode globally?", false);
    // Project testMode overrides global testMode when set.
    await globalSettingsStore.updateSettings({ testMode });

    let projectContext: Awaited<ReturnType<typeof resolveProject>> | undefined;
    try {
      projectContext = await resolveProject(undefined);
    } catch {
      projectContext = undefined;
    }

    if (projectContext) {
      const rawMaxConcurrent = await prompts.prompt(
        "Set maxConcurrent for this project",
        String((await projectContext.store.getSettings()).maxConcurrent ?? 2),
      );
      const maxConcurrent = validateMaxConcurrent(rawMaxConcurrent);
      await projectContext.store.updateSettings({ maxConcurrent });
      console.log(`✓ Project maxConcurrent set to ${maxConcurrent}`);
    } else {
      console.log("Skipping maxConcurrent (no active project found).");
    }

    console.log("\nNext steps:");
    console.log("  fn dashboard      # launch dashboard");
    console.log("  fn task create    # create your first task");

    await globalSettingsStore.updateSettings({
      cliOnboardingCompletedAt: new Date().toISOString(),
    });
    console.log("\n✓ Onboarding complete");
  } catch (error) {
    if (error instanceof Error && error.message === PROMPT_CANCELLED_ERROR) {
      throw new Error("Onboarding cancelled.");
    }
    throw error;
  } finally {
    prompts.close();
  }
}

export const __testUtils = {
  createPromptSession,
  validateMaxConcurrent,
  PROMPT_CANCELLED_ERROR,
};
