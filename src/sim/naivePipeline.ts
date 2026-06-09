import shader from "../shaders/naive.wgsl?raw";

export function createNaivePipeline(device: GPUDevice): GPUComputePipeline {
  return device.createComputePipeline({
    layout: "auto",
    compute: { module: device.createShaderModule({ code: shader }), entryPoint: "main" },
  });
}
