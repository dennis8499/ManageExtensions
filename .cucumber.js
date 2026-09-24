module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    require: ['out/test/acceptance/**/*.js'],
    format: ['progress']
  }
};
