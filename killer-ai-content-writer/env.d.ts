/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

declare module "*.md?raw" {
  const content: string;
  export default content;
}
