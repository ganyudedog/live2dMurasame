import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const loadSherpa = () => require('sherpa-onnx-node');

export const createAsrAdapter = (options = {}) => {
  const mode = options.mode === 'remote' ? 'remote' : 'local';
  const engine = typeof options.engine === 'string' && options.engine.trim() ? options.engine.trim() : 'sherpa-onnx';
  if (mode === 'remote') {
    throw new Error('远程 ASR 适配器尚未实现，请先选择本地模式');
  }
  if (engine !== 'sherpa-onnx') {
    throw new Error(`暂不支持 ASR 引擎: ${engine}`);
  }
  const modelDir = typeof options.modelDir === 'string' ? path.normalize(options.modelDir.trim()) : '';
  if (!modelDir) throw new Error('ASR 本地模型目录未配置');
  const model = {
    encoder: path.join(modelDir, 'encoder.onnx'),
    decoder: path.join(modelDir, 'decoder.onnx'),
    joiner: path.join(modelDir, 'joiner.onnx'),
    tokens: path.join(modelDir, 'tokens.txt'),
  };
  const missing = Object.values(model).filter((file) => !fs.existsSync(file));
  if (missing.length) throw new Error(`ASR 模型文件缺失: ${missing.join(', ')}`);
  const sherpa = loadSherpa();
  return {
    mode,
    engine,
    createRecognizer() {
      return new sherpa.OnlineRecognizer({
        featConfig: {
          sampleRate: Number.isFinite(options.sampleRate) ? options.sampleRate : 16000,
          featureDim: Number.isFinite(options.featureDim) ? options.featureDim : 80,
        },
        modelConfig: {
          transducer: {
            encoder: model.encoder,
            decoder: model.decoder,
            joiner: model.joiner,
          },
          tokens: model.tokens,
          numThreads: Number.isFinite(options.numThreads) ? options.numThreads : 2,
          provider: typeof options.provider === 'string' ? options.provider : 'cpu',
          debug: Number.isFinite(options.debug) ? options.debug : 0,
        },
        decodingMethod: 'greedy_search',
        maxActivePaths: 4,
        enableEndpoint: true,
        rule1MinTrailingSilence: Number.isFinite(options.rule1MinTrailingSilence) ? options.rule1MinTrailingSilence : 2.4,
        rule2MinTrailingSilence: Number.isFinite(options.rule2MinTrailingSilence) ? options.rule2MinTrailingSilence : 1.2,
        rule3MinUtteranceLength: Number.isFinite(options.rule3MinUtteranceLength) ? options.rule3MinUtteranceLength : 20,
      });
    },
  };
};
