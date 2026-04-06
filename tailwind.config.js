/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './views/**/*.ejs',
        './lib/**/*.ts',
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
            },
        },
    },
    plugins: [],
};
