import { marked } from 'marked';
import matter from 'gray-matter';
import fs from 'fs/promises';
import path from 'path';
import DOMPurify from 'isomorphic-dompurify';

const CONTENT_DIR = path.join(__dirname, '../content');
const OUTPUT_DIR = path.join(__dirname, '../docs');
const PUBLIC_DIR = path.join(__dirname, '../public');

// Base path for GitHub Pages (empty for root domain, or '/repo-name' for project pages)
// Validate BASE_PATH to prevent injection attacks
function validateBasePath(basePath: string): string {
  if (!basePath) return '';
  // Only allow alphanumeric, hyphens, underscores, and forward slashes
  if (!/^[a-zA-Z0-9/_-]+$/.test(basePath)) {
    throw new Error('Invalid BASE_PATH: contains unsafe characters');
  }
  // Remove leading/trailing slashes
  return basePath.replace(/^\/+|\/+$/g, '');
}

const BASE_PATH = validateBasePath(process.env.BASE_PATH || '');

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

interface PageData {
  slug: string;
  title: string;
  content: string;
  frontmatter: any;
  relativePath: string;
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  title?: string;
}

let allPages: PageData[] = [];

// Function to build file tree structure
async function buildFileTree(dir: string, relativePath: string = ''): Promise<FileNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, relPath);
      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'folder',
        children: children.sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === 'folder' ? -1 : 1;
        }),
      });
    } else if (entry.name.endsWith('.md')) {
      const slug = relPath.replace(/\.md$/, '').replace(/\\/g, '/');
      const page = allPages.find(p => p.slug === slug);
      nodes.push({
        name: entry.name.replace(/\.md$/, ''),
        path: relPath,
        type: 'file',
        title: page?.frontmatter?.title || entry.name.replace(/\.md$/, ''),
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'folder' ? -1 : 1;
  });
}

// Function to parse markdown file
async function parseMarkdownFile(filePath: string, relativePath: string): Promise<PageData> {
  const fileContent = await fs.readFile(filePath, 'utf-8');
  const { data: frontmatter, content } = matter(fileContent);
  const html = await marked(content);

  // Sanitize HTML to prevent XSS attacks
  const sanitizedHtml = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'div', 'span'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id'],
    ALLOW_DATA_ATTR: false,
  });

  const slug = relativePath.replace(/\.md$/, '').replace(/\\/g, '/');

  return {
    frontmatter,
    content: sanitizedHtml,
    slug,
    title: frontmatter.title || slug,
    relativePath,
  };
}

// Recursively load all markdown files
async function loadMarkdownFilesRecursive(dir: string, relativePath: string = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      await loadMarkdownFilesRecursive(fullPath, relPath);
    } else if (entry.name.endsWith('.md')) {
      const parsed = await parseMarkdownFile(fullPath, relPath);
      allPages.push(parsed);
    }
  }
}

// Generate static HTML file
function generateStaticHTML(fileTree: FileNode[], pageData?: PageData): string {
  const renderTree = (nodes: FileNode[]): string => {
    if (!nodes || nodes.length === 0) return '';

    return nodes.map(node => {
      if (node.type === 'folder') {
        const hasChildren = node.children && node.children.length > 0;
        return `
          <div class="folder-item ${hasChildren ? 'has-children' : ''}">
            <div class="folder-header">
              <span class="folder-icon">▸</span>
              <span class="folder-name">${node.name}</span>
            </div>
            ${hasChildren ? `<div class="folder-children" style="display: none;">${renderTree(node.children!)}</div>` : ''}
          </div>
        `;
      } else {
        const slug = node.path.replace(/\.md$/, '').replace(/\\/g, '/');
        const activeClass = pageData && pageData.slug === slug ? 'active' : '';
        return `
          <a href="${BASE_PATH ? BASE_PATH + '/' : ''}${slug}.html" class="file-item ${activeClass}" data-slug="${slug}">
            <span class="file-name">${node.title || node.name}</span>
          </a>
        `;
      }
    }).join('');
  };

  const contentHTML = pageData ? `
    <article class="page-content">
      <header class="page-header">
        <h1>${pageData.title}</h1>
        ${pageData.frontmatter.date ? `<time>${new Date(pageData.frontmatter.date).toLocaleDateString()}</time>` : ''}
        ${pageData.frontmatter.tags && pageData.frontmatter.tags.length ? `
          <div class="tags">
            ${pageData.frontmatter.tags.map((tag: string) => `<span class="tag">${tag}</span>`).join('')}
          </div>
        ` : ''}
      </header>
      <div class="markdown-content">
        ${pageData.content}
      </div>
    </article>
  ` : `
    <div class="welcome-screen">
      <h1>Welcome to Your Notes</h1>
      <p>Select a note from the sidebar to get started</p>
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageData ? pageData.title : 'My Notes'}</title>
  <link rel="stylesheet" href="${BASE_PATH ? BASE_PATH + '/' : ''}public/style.css">
</head>
<body>
  <div class="app-container">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <h2>My Notes</h2>
        <button class="close-sidebar" id="closeSidebar" aria-label="Close sidebar">✕</button>
      </div>

      <nav class="file-tree" id="fileTree">
        ${fileTree.length === 0 ? `
          <div class="empty-tree">
            <p>No files yet</p>
            <small>Add .md files to content/</small>
          </div>
        ` : renderTree(fileTree)}
      </nav>
    </aside>

    <main class="main-content">
      <!-- Mobile Menu Toggle -->
      <button class="mobile-menu-toggle" id="mobileMenuToggle" aria-label="Toggle menu">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>

      <div class="content-wrapper" id="contentWrapper">
        ${contentHTML}
      </div>
    </main>
  </div>
  <script>
    function toggleFolder(element) {
      const folder = element.closest('.folder-item');
      const children = folder.querySelector('.folder-children');
      folder.classList.toggle('expanded');
      if (children) {
        children.style.display = folder.classList.contains('expanded') ? 'block' : 'none';
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      // Folder toggle handlers
      document.querySelectorAll('.folder-header').forEach(header => {
        header.addEventListener('click', (e) => {
          e.preventDefault();
          toggleFolder(header);
        });
      });

      // Mobile sidebar toggle
      const mobileMenuToggle = document.getElementById('mobileMenuToggle');
      const closeSidebar = document.getElementById('closeSidebar');
      const sidebar = document.getElementById('sidebar');

      if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', () => {
          sidebar.classList.add('mobile-open');
          mobileMenuToggle.style.opacity = '0';
          mobileMenuToggle.style.visibility = 'hidden';
        });
      }

      if (closeSidebar) {
        closeSidebar.addEventListener('click', () => {
          sidebar.classList.remove('mobile-open');
          mobileMenuToggle.style.opacity = '1';
          mobileMenuToggle.style.visibility = 'visible';
        });
      }
    });
  </script>
</body>
</html>`;
}

// Build static site
async function build() {
  console.log('Starting build process...');

  // Clean output directory
  try {
    await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
  } catch (error) {
    // Directory might not exist
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // Copy public directory
  try {
    const publicOutputDir = path.join(OUTPUT_DIR, 'public');
    await fs.cp(PUBLIC_DIR, publicOutputDir, { recursive: true });
    console.log('Copied public assets');
  } catch (error) {
    console.log('No public directory to copy');
  }

  // Load all markdown files
  allPages = [];
  await loadMarkdownFilesRecursive(CONTENT_DIR);

  // Build file tree
  const fileTree = await buildFileTree(CONTENT_DIR);

  console.log(`Loaded ${allPages.length} markdown files`);

  // Generate index page
  const indexHtml = generateStaticHTML(fileTree);
  await fs.writeFile(path.join(OUTPUT_DIR, 'index.html'), indexHtml);
  console.log('Generated index.html');

  // Generate individual pages
  for (const page of allPages) {
    const html = generateStaticHTML(fileTree, page);
    const outputPath = path.join(OUTPUT_DIR, `${page.slug}.html`);

    // Create subdirectories if needed
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });

    await fs.writeFile(outputPath, html);
    console.log(`Generated ${page.slug}.html`);
  }

  // Generate 404 page
  const notFoundHtml = generateStaticHTML(fileTree);
  await fs.writeFile(path.join(OUTPUT_DIR, '404.html'), notFoundHtml);
  console.log('Generated 404.html');

  // Create .nojekyll file to prevent GitHub Pages from using Jekyll
  await fs.writeFile(path.join(OUTPUT_DIR, '.nojekyll'), '');
  console.log('Created .nojekyll file');

  console.log(`\nBuild complete! Generated ${allPages.length} pages in ${OUTPUT_DIR}`);
}

build().catch(console.error);
