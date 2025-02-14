module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ["/lib/"],
  transform: {
    '^.+\\.[tj]sx?$': 'babel-jest',
  },
};
