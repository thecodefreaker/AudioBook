import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        navigator: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Blob: "readonly",
        Event: "readonly",
        FormData: "readonly",
        FileReader: "readonly",
        AbortController: "readonly",
        HTMLElement: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "off"
    }
  }
];
