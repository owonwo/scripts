import { Command, Options } from "@effect/cli";
import { NodeRuntime } from "@effect/platform-node";
import { CliErrorHandler, ConsolaLayer } from "@wigxel/cli-core";
import { Effect } from "effect";
import { CreateAccountStatus, CreateTransferStatus, createClient } from "tigerbeetle-node";

const clusterId = Options.integer("cluster-id").pipe(
  Options.withAlias("c"),
  Options.withDefault(0),
);

const replicaAddresses = Options.text("addresses").pipe(
  Options.withAlias("a"),
  Options.withDefault("3000"),
);

const command = Command.make(
  "tb-debugger",
  { clusterId, replicaAddresses },
  ({ clusterId, replicaAddresses }) =>
    Effect.gen(function* () {
      const addresses = replicaAddresses.split(",").map((addr) => addr.trim());

      yield* Effect.logInfo(`Connecting to TigerBeetle cluster ${clusterId} at ${addresses.join(", ")}`);

      const client = createClient({
        cluster_id: BigInt(clusterId),
        replica_addresses: addresses,
      });

      yield* Effect.logInfo("Connected to TigerBeetle");

      // Generate unique account IDs using timestamps
      const fundingAccountId = BigInt(Date.now());
      const targetAccountId = fundingAccountId + 1n;

      yield* Effect.logInfo(`Creating funding account with ID: ${fundingAccountId}`);

      const fundingAccountResults = yield* Effect.tryPromise({
        try: () =>
          client.createAccounts([
            {
              id: fundingAccountId,
              debits_pending: 0n,
              debits_posted: 0n,
              credits_pending: 0n,
              credits_posted: 0n,
              user_data_128: 0n,
              user_data_64: 0n,
              user_data_32: 0,
              reserved: 0,
              ledger: 1,
              code: 1,
              flags: 0,
              timestamp: 0n,
            },
          ]),
        catch: (error) => new Error(`Failed to create funding account: ${error}`),
      });

      if (fundingAccountResults[0].status !== CreateAccountStatus.created) {
        yield* Effect.logError(`Failed to create funding account: ${fundingAccountResults[0].status}`);
        yield* Effect.fail(new Error("Failed to create funding account"));
      }

      yield* Effect.logInfo(`Funding account created with ID: ${fundingAccountId}`);

      yield* Effect.logInfo(`Creating target account with ID: ${targetAccountId}`);

      const targetAccountResults = yield* Effect.tryPromise({
        try: () =>
          client.createAccounts([
            {
              id: targetAccountId,
              debits_pending: 0n,
              debits_posted: 0n,
              credits_pending: 0n,
              credits_posted: 0n,
              user_data_128: 0n,
              user_data_64: 0n,
              user_data_32: 0,
              reserved: 0,
              ledger: 1,
              code: 1,
              flags: 0,
              timestamp: 0n,
            },
          ]),
        catch: (error) => new Error(`Failed to create target account: ${error}`),
      });

      if (targetAccountResults[0].status !== CreateAccountStatus.created) {
        yield* Effect.logError(`Failed to create target account: ${targetAccountResults[0].status}`);
        yield* Effect.fail(new Error("Failed to create target account"));
      }

      yield* Effect.logInfo(`Target account created with ID: ${targetAccountId}`);

      // Initial funding transfer
      const initialTransferId = BigInt(Date.now());
      yield* Effect.logInfo(`Performing initial funding transfer of 1000`);

      const initialTransferResults = yield* Effect.tryPromise({
        try: () =>
          client.createTransfers([
            {
              id: initialTransferId,
              debit_account_id: fundingAccountId,
              credit_account_id: targetAccountId,
              amount: 1000n,
              pending_id: 0n,
              user_data_128: 0n,
              user_data_64: 0n,
              user_data_32: 0,
              timeout: 0,
              ledger: 1,
              code: 1,
              flags: 0,
              timestamp: 0n,
            },
          ]),
        catch: (error) => new Error(`Failed to perform initial transfer: ${error}`),
      });

      if (initialTransferResults[0].status !== CreateTransferStatus.created) {
        yield* Effect.logError(`Failed to perform initial transfer: ${initialTransferResults[0].status}`);
        yield* Effect.fail(new Error("Failed to perform initial transfer"));
      }

      yield* Effect.logInfo(`Initial funding transfer completed: ${initialTransferId}`);

      // Increment loop - transfer 1 every 8 seconds
      yield* Effect.logInfo("Starting increment loop (1 every 8 seconds)");
      yield* Effect.log("Press Ctrl+C to stop");

      let incrementCount = 0;

      const incrementLoop = Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep("8 seconds");

          incrementCount++;
          const transferId = BigInt(Date.now() + incrementCount);

          yield* Effect.log(`[${new Date().toISOString()}] Increment #${incrementCount}: Transferring 1`);

          const transferResults = yield* Effect.tryPromise({
            try: () =>
              client.createTransfers([
                {
                  id: transferId,
                  debit_account_id: fundingAccountId,
                  credit_account_id: targetAccountId,
                  amount: 1n,
                  pending_id: 0n,
                  user_data_128: 0n,
                  user_data_64: 0n,
                  user_data_32: 0,
                  timeout: 0,
                  ledger: 1,
                  code: 1,
                  flags: 0,
                  timestamp: 0n,
                },
              ]),
            catch: (error) => new Error(`Transfer failed: ${error}`),
          });

          if (transferResults[0].status === CreateTransferStatus.created) {
            yield* Effect.logInfo(`Increment #${incrementCount} completed successfully`);
          } else {
            yield* Effect.logError(`Increment #${incrementCount} failed: ${transferResults[0].status}`);
          }

          // Log current balances
          const accounts = yield* Effect.tryPromise({
            try: () => client.lookupAccounts([targetAccountId]),
            catch: (error) => new Error(`Failed to lookup accounts: ${error}`),
          });

          if (accounts.length > 0) {
            const account = accounts[0];
            yield* Effect.log(
              `Current balance - Debits posted: ${account.debits_posted}, Credits posted: ${account.credits_posted}`,
            );
          }
        }
      });

      yield* incrementLoop;
    }),
);

const program = Command.run(command, {
  name: "tb-debugger",
  version: "0.1.0",
})(process.argv);

const cliArgs = process.argv.filter((arg) => arg !== "--");

const main = program(cliArgs).pipe(
  Effect.provide(ConsolaLayer),
);

main.pipe(
  CliErrorHandler.formatErrors,
  NodeRuntime.runMain,
);
