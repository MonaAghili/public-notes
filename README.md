# Static site generator

A simple markdown-based static site generator for GitHub Pages.

## Running Locally

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development server:**
   ```bash
   npm run dev
   ```

3. **Visit:** http://localhost:3000

Add your `.md` files to the `content/` folder and they'll appear in the sidebar.

## Building

Generate static HTML files:

```bash
npm run build
```

This creates a static site in the `docs/` folder ready for deployment.

## Deploy to GitHub Pages

### Setup (One Time)

1. Create a new repository on GitHub
2. Push your code:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin master
   ```

3. Enable GitHub Pages:
   - Go to your repository on GitHub
   - Click **Settings** → **Pages**
   - Under **Source**, select **GitHub Actions**
   - The workflow will automatically deploy on push

### Deploy Updates

Whenever you want to update your site:

```bash
npm run build
git add .
git commit -m "Update content"
git push
```

Your site will be live at: `https://YOUR-USERNAME.github.io/YOUR-REPO/`

## Markdown Format

Add frontmatter to your markdown files:

```markdown
---
title: My Page Title
description: A short description
date: 2025-01-15
tags:
  - tag1
  - tag2
---

# Your Content Here

Write your content using standard markdown...
```

## Customization

- **Styles**: Edit `public/style.css`
- **Colors**: Change CSS variables in `:root` section
- **Site name**: Edit `views/app.ejs` (change "My Wiki")

## License

ISC
