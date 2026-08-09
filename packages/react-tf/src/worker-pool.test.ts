import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WORKER_CODE } from "./cli";

// Worker pool logic extracted for testing
function createWorkerPool(
  files: string[],
  numWorkers: number,
): Promise<{ results: unknown[]; duration: number }> {
  return new Promise((resolve, reject) => {
    const results: unknown[] = [];
    let fileIndex = 0;
    let workersAlive = 0;
    let finished = false;
    const start = performance.now();

    function sendNextToWorker(worker: Worker) {
      if (fileIndex < files.length) {
        const filePath = files[fileIndex++];
        worker.postMessage({ filePath });
      } else {
        worker.postMessage({ done: true });
      }
    }

    function checkDone() {
      if (finished) return;
      if (workersAlive === 0) {
        finished = true;
        resolve({ results, duration: performance.now() - start });
      }
    }

    const num = Math.min(numWorkers, files.length);

    for (let i = 0; i < num; i++) {
      workersAlive++;
      const worker = new Worker(WORKER_CODE, { eval: true });

      worker.on("message", (result: unknown) => {
        results.push(result);
        sendNextToWorker(worker);
      });

      worker.on("error", (err) => {
        reject(err);
      });

      worker.on("exit", () => {
        workersAlive--;
        checkDone();
      });

      sendNextToWorker(worker);
    }
  });
}

describe("worker pool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "worker-pool-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTestFile(name: string, content: string): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  it("processes multiple files across workers", async () => {
    const files = Array.from({ length: 6 }, (_, i) =>
      writeTestFile(
        `Comp${i}.tsx`,
        `const Comp${i} = () => { return <div>{${i}}</div>; };`,
      ),
    );

    const { results } = await createWorkerPool(files, 2);

    expect(results).toHaveLength(6);
    for (const r of results) {
      expect(r).toHaveProperty("success", true);
      expect(r).toHaveProperty("componentsFound", 1);
    }
  });

  it("skips files with no components", async () => {
    const files = [
      writeTestFile("WithComponent.tsx", `const Box = () => { return <div/>; };`),
      writeTestFile("NoComponent.tsx", `const x = 42;`),
      writeTestFile("Empty.tsx", `// just a comment`),
    ];

    const { results } = await createWorkerPool(files, 2);

    expect(results).toHaveLength(3);
    const withComp = results.find((r: any) => r.filePath.includes("WithComponent"));
    const noComp = results.find((r: any) => r.filePath.includes("NoComponent"));
    const empty = results.find((r: any) => r.filePath.includes("Empty"));

    expect(withComp).toHaveProperty("componentsFound", 1);
    expect(noComp).toHaveProperty("componentsFound", 0);
    expect(empty).toHaveProperty("componentsFound", 0);
  });

  it("handles non-tsx files gracefully", async () => {
    const files = [
      writeTestFile("good.tsx", `const Box = () => { return <div/>; };`),
      writeTestFile("bad.ts", `const Box = () => {};`),
    ];

    const { results } = await createWorkerPool(files, 2);

    expect(results).toHaveLength(2);
    const tsx = results.find((r: any) => r.filePath.endsWith(".tsx"));
    const ts = results.find((r: any) => r.filePath.endsWith(".ts"));

    expect(tsx).toHaveProperty("success", true);
    expect(ts).toHaveProperty("success", false);
    expect(ts).toHaveProperty("message", "Not a TSX file");
  });

  it("handles non-existent files without crashing", async () => {
    const files = ["/tmp/definitely-does-not-exist-12345.tsx"];

    const { results } = await createWorkerPool(files, 1);

    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty("success", false);
    expect(results[0]).toHaveProperty("message", "File not found");
  });

  it("lazy-inits ts-morph Project only when needed", async () => {
    // Files with no components should never trigger Project creation
    const files = Array.from({ length: 4 }, (_, i) =>
      writeTestFile(`NoComp${i}.tsx`, `const x${i} = 42;`),
    );

    const { results, duration } = await createWorkerPool(files, 2);

    // All should be skipped, no Project init needed
    for (const r of results) {
      expect(r).toHaveProperty("componentsFound", 0);
    }
    // Should be fast since no Project was created
    expect(duration).toBeLessThan(2000);
  });

  it("works with different worker counts", async () => {
    // Run 1: 2 workers
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "worker-pool-2w-"));
    const files2 = Array.from({ length: 8 }, (_, i) => {
      const filePath = path.join(tmpDir2, `Comp${i}.tsx`);
      fs.writeFileSync(
        filePath,
        `const Comp${i} = ({ val }: { val: number }) => { return <div>{val}</div>; };`,
      );
      return filePath;
    });

    const { results: results2 } = await createWorkerPool(files2, 2);
    expect(results2).toHaveLength(8);
    for (const r of results2) {
      expect(r).toHaveProperty("success", true);
      expect(r).toHaveProperty("componentsFound", 1);
    }

    // Run 2: 4 workers (fresh files)
    const tmpDir4 = fs.mkdtempSync(path.join(os.tmpdir(), "worker-pool-4w-"));
    const files4 = Array.from({ length: 8 }, (_, i) => {
      const filePath = path.join(tmpDir4, `Comp${i}.tsx`);
      fs.writeFileSync(
        filePath,
        `const Comp${i} = ({ val }: { val: number }) => { return <div>{val}</div>; };`,
      );
      return filePath;
    });

    const { results: results4 } = await createWorkerPool(files4, 4);
    expect(results4).toHaveLength(8);
    for (const r of results4) {
      expect(r).toHaveProperty("success", true);
      expect(r).toHaveProperty("componentsFound", 1);
    }

    fs.rmSync(tmpDir2, { recursive: true, force: true });
    fs.rmSync(tmpDir4, { recursive: true, force: true });
  }, 15000);
});
