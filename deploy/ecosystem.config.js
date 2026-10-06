// pm2: API ed engine fuori da Docker (VPS condiviso). Le variabili arrivano da un file
// env letto da Node (--env-file). Copiato in /mentorchess/ecosystem.config.js sul server.
const ROOT = process.env.MENTORCHESS_ROOT || '/mentorchess';
const ENV_FILE = `${ROOT}/env/mentorchess.env`;

module.exports = {
  apps: [
    {
      name: 'mentorchess-engine',
      cwd: `${ROOT}/mcbe/services/engine`,
      script: 'dist/index.js',
      node_args: `--env-file=${ENV_FILE}`,
      max_memory_restart: '500M',
      out_file: `${ROOT}/log/engine.out.log`,
      error_file: `${ROOT}/log/engine.err.log`,
      time: true,
    },
    {
      name: 'mentorchess-api',
      cwd: `${ROOT}/mcbe/services/api`,
      script: 'dist/server.js',
      node_args: `--env-file=${ENV_FILE}`,
      max_memory_restart: '400M',
      out_file: `${ROOT}/log/api.out.log`,
      error_file: `${ROOT}/log/api.err.log`,
      time: true,
    },
  ],
};
