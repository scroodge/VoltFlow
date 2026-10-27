import assert from "node:assert/strict";
import test from "node:test";

// Benchmark helper to simulate upload network latency
async function simulateUploadKnowledgeImage(file, bucket, delayMs = 50) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return `https://example.com/storage/${bucket}/${file.name}`;
}

// Baseline implementation (Sequential)
async function uploadImageListSequential(files, bucket) {
  const uploads = files.filter((file) => file && file.size > 0);
  const images = [];

  for (const file of uploads) {
    images.push({
      url: await simulateUploadKnowledgeImage(file, bucket),
      alt: file.name.replace(/\.[^.]+$/, ""),
    });
  }

  return images;
}

// Optimized implementation (Concurrent)
async function uploadImageListConcurrent(files, bucket) {
  const uploads = files.filter((file) => file && file.size > 0);

  return Promise.all(
    uploads.map(async (file) => ({
      url: await simulateUploadKnowledgeImage(file, bucket),
      alt: file.name.replace(/\.[^.]+$/, ""),
    }))
  );
}

test("uploadImageList produces expected output and alt titles", async () => {
  const mockFiles = [
    { name: "part1.png", size: 100 },
    { name: "part2.jpg", size: 200 },
    { name: "empty.png", size: 0 },
    null,
  ];

  const resultSequential = await uploadImageListSequential(mockFiles, "test-bucket");
  const resultConcurrent = await uploadImageListConcurrent(mockFiles, "test-bucket");

  const expected = [
    { url: "https://example.com/storage/test-bucket/part1.png", alt: "part1" },
    { url: "https://example.com/storage/test-bucket/part2.jpg", alt: "part2" },
  ];

  assert.deepEqual(resultSequential, expected);
  assert.deepEqual(resultConcurrent, expected);
});

test("benchmark sequential vs concurrent upload performance", async () => {
  const mockFiles = Array.from({ length: 5 }, (_, i) => ({
    name: `image_${i + 1}.png`,
    size: 1024,
  }));

  const delayMs = 50;

  const startSeq = performance.now();
  await uploadImageListSequential(mockFiles, "benchmark-bucket");
  const durationSeq = performance.now() - startSeq;

  const startConc = performance.now();
  await uploadImageListConcurrent(mockFiles, "benchmark-bucket");
  const durationConc = performance.now() - startConc;

  console.log(`\n--- BENCHMARK RESULTS (5 files, ${delayMs}ms delay/file) ---`);
  console.log(`Sequential execution time: ${durationSeq.toFixed(2)} ms`);
  console.log(`Concurrent execution time: ${durationConc.toFixed(2)} ms`);
  console.log(`Speedup factor: ${(durationSeq / durationConc).toFixed(2)}x`);
  console.log(`----------------------------------------------------\n`);

  // Sequential for 5 files with 50ms delay should take ~250ms
  // Concurrent should take ~50-70ms
  assert.ok(
    durationConc < durationSeq,
    `Concurrent (${durationConc.toFixed(2)}ms) should be faster than sequential (${durationSeq.toFixed(2)}ms)`,
  );
});
