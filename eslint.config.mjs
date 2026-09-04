import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	enableTypescript: true,
})

export default [
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
