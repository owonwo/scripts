import { createClient } from '@hey-api/openapi-ts';
import postmanToOpenApi from '@readme/postman-to-openapi';
import { defineCommand } from "citty";
import { Match, pipe, Schema } from "effect";
import { readFile } from "fs/promises";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { config, configFile } from "~/config";
import { rootLogger } from "~/logger";
import { type InputEntry, input } from "~/schema";

export default defineCommand({
  meta: {
    name: "api",
    description: "Generate fetchers and hooks from Postman collection"
  },
  args: {
    path: {
      type: 'string',
      description: 'API Spec location',
      required: false
    },
    destination: {
      type: 'string',
      description: 'Output directory',
      required: false
    },
    'client-only': {
      type: 'boolean',
      description: 'Generate only TypeScript client (no hooks)',
      default: false
    },
    'hooks-only': {
      type: 'boolean',
      description: 'Generate only React Query hooks (no client)',
      default: false
    }
  },
  async setup({ args }) {
    rootLogger.debug("$$", config);
    const inputs = config.input;

    for (const input_entry of inputs) {
      const input_parsed = InputImpl.normalize(input_entry);
      const output_dir = args.destination ?? config.output;

      let tmpDir: string | null = null;
      try {
        const p_input = input_parsed.type === "postman" ?
          await postmanToOpenAPISpecs(input_parsed.path)
          : input_parsed.path;

        if (input_parsed.type === "postman") {
          tmpDir = join(p_input, "..");
        }

        // Determine what to generate
        const generateClient = !args['hooks-only'];
        const generateHooks = !args['client-only'];


        await createClient({
          input: p_input,
          output: output_dir,
          // @ts-expect-error
          plugins: [
            ...(generateClient ? ['@hey-api/typescript', '@hey-api/sdk'] : []),
            ...(generateHooks ? ['@tanstack/react-query'] : [])
          ],
          configFile: configFile,
          ...(args['hooks-only'] && {
            client: false,
            types: false,
            services: false
          })
        });

        // Check for missing peer dependencies
        if (generateHooks) {
          await checkMissingPeerDeps(output_dir);
        }

        if (generateClient && generateHooks) {
          rootLogger.success("🎉 Generated API client and React hooks");
        } else if (generateClient) {
          rootLogger.success("🎉 Generated API client");
        } else {
          rootLogger.success("🎉 Generated React hooks");
        }

      } catch (err) {
        console.log(err);
      } finally {
        if (tmpDir) {
          await cleanupTmpDir(tmpDir);
        }
      }
    }
  }
});

async function postmanToOpenAPISpecs(path_to_collection: string) {
  const tmpDir = await mkdtemp(join(tmpdir(), "crag-"));
  const tmpFile = join(tmpDir, "spec.yml");
  try {
    // @ts-expect-error
    const yaml = await postmanToOpenApi(path_to_collection, null, { defaultTag: 'General' });
    await writeFile(tmpFile, yaml, "utf-8");
    return tmpFile;
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error("Error generating OpenAPI spec from Postman Collection", { cause: error });
  }
}

async function cleanupTmpDir(tmpDir: string) {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}

const InputImpl = {
  normalize(input_entry: InputEntry) {
    const encode = Schema.encodeSync(input);

    return pipe(
      Match.value(input_entry),
      Match.when(Match.string, (path) => {
        return encode({
          type: "openapi",
          path: path
        })
      }),
      Match.orElse((e) => encode(e)),
    )
  },
}

async function checkMissingPeerDeps(outputDir: string) {
  // Map of plugins to their required peer dependencies
  const peerDeps: Record<string, string[]> = {
    '@tanstack/react-query': ['@tanstack/react-query']
  };

  // Find the nearest package.json by walking up from outputDir
  let currentDir = resolve(outputDir);
  let packageJsonPath: string | null = null;

  while (currentDir !== '/') {
    const potentialPath = join(currentDir, 'package.json');
    try {
      await readFile(potentialPath, 'utf-8');
      packageJsonPath = potentialPath;
      break;
    } catch {
      currentDir = join(currentDir, '..');
    }
  }

  if (!packageJsonPath) {
    rootLogger.warn('⚠️  Could not find package.json to check peer dependencies');
    return;
  }

  try {
    const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies
    };

    const missingDeps: string[] = [];

    // Check for @tanstack/react-query if hooks were generated
    if (peerDeps['@tanstack/react-query']) {
      for (const dep of peerDeps['@tanstack/react-query']) {
        if (!allDeps[dep]) {
          missingDeps.push(dep);
        }
      }
    }

    if (missingDeps.length > 0) {
      rootLogger.warn(`⚠️  Missing peer dependencies for generated hooks:`);
      for (const dep of missingDeps) {
        rootLogger.warn(`   - ${dep}`);
      }
      rootLogger.warn(`   Add them to your package.json:`);
      rootLogger.warn(`   ${missingDeps.map(d => `"${d}": "^5.0.0"`).join(', ')}`);
    }
  } catch (error) {
    rootLogger.debug('Could not read package.json for peer dependency check');
  }
}
