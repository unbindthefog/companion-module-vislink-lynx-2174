import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	enableTypescript: true,
})

export default [
	{
		// Captured device responses: someone else's 2011 JavaScript, kept verbatim
		// as evidence. Linting it would be linting the receiver.
		ignores: ['fixtures/**'],
	},
	...baseConfig,
	{
		// Development-only helpers and the tests. Neither is packaged with the
		// module, and both deliberately import the built output in dist/ — the
		// tests because it is the built module Companion loads, so that is the
		// thing worth asserting about.
		files: ['tools/**/*.mjs', 'test/**/*.js'],
		rules: {
			'n/no-unpublished-import': 'off',
		},
	},
]
