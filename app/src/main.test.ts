test("entry does not load the Vite template index.css", () => {
  const source = import.meta.glob("./main.tsx", {
    eager: true,
    import: "default",
    query: "?raw",
  })["./main.tsx"] as string;

  expect(source).not.toMatch(/import\s+["']\.\/index\.css["']/);
});
