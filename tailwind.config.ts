import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // 品牌主色系 - 极简专业金融质感
        primary: {
          DEFAULT: "#003e7e",
          hover: "#002b5e",
          light: "#004a96",
          dark: "#002347",
        },
        // 语义化背景色
        background: "var(--background)",
        foreground: "var(--foreground)",
        // 边框色 - 极细、克制
        border: {
          subtle: "rgb(228 228 231 / 0.6)", // zinc-200/60
          DEFAULT: "rgb(228 228 231)", // zinc-200
        },
      },
      borderRadius: {
        // 收敛圆角，更严谨锋利
        sm: "0.25rem", // 4px
        DEFAULT: "0.375rem", // 6px
        md: "0.375rem", // 6px (统一为 6px)
        lg: "0.5rem", // 8px (保留但不推荐使用)
      },
      boxShadow: {
        // 极简阴影系统 - 只用于真正的悬浮层
        subtle: "0 1px 2px 0 rgb(0 0 0 / 0.03)",
        float: "0 10px 25px -5px rgb(0 0 0 / 0.05), 0 8px 10px -6px rgb(0 0 0 / 0.03)",
        modal: "0 20px 50px -12px rgb(0 0 0 / 0.08), 0 8px 16px -8px rgb(0 0 0 / 0.04)",
      },
      transitionDuration: {
        DEFAULT: "200ms",
      },
    },
  },
  plugins: [],
};

export default config;
