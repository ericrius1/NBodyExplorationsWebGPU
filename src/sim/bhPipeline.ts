import shader from "../shaders/barnes_hut.wgsl?raw";

export function createBhPipeline(device: GPUDevice): GPUComputePipeline {
  return device.createComputePipeline({
    layout: "auto",
    compute: { module: device.createShaderModule({ code: shader }), entryPoint: "main" },
  });
}
