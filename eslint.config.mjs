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
		// Development-only helpers. They are never packaged with the module, and
		// the smoke test deliberately imports the built output in dist/.
		files: ['tools/**/*.mjs'],
		rules: {
			'n/no-unpublished-import': 'off',
		},
	},
]
