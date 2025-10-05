import express, { Request, Response } from 'express';
import { marked } from 'marked';
import matter from 'gray-matter';
import fs from 'fs/promises';
import path from 'path';
import chokidar from 'chokidar';
import DOMPurify from 'isomorphic-dompurify';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();
const PORT = process.env.PORT || 3000;
const CONTENT_DIR = path.join(__dirname, '../content');

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});

const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit search to 30 requests per minute
  message: 'Too many search requests, please try again later.',
});

// Set up view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Serve static files
app.use('/public', express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  title?: string;
}

interface PageData {
  frontmatter: any;
  content: string;
  slug: string;
  filePath: string;
  relativePath: string;
}

// Cache for markdown files
let markdownCache: Map<string, PageData> = new Map();
let fileTree: FileNode[] = [];

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
      const cached = markdownCache.get(slug);
      nodes.push({
        name: entry.name.replace(/\.md$/, ''),
        path: relPath,
        type: 'file',
        title: cached?.frontmatter?.title || entry.name.replace(/\.md$/, ''),
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'folder' ? -1 : 1;
  });
}

// Function to validate slug to prevent path traversal
function validateSlug(slug: string): boolean {
  // Reject slugs with path traversal attempts
  if (slug.includes('..')) return false;
  // Only allow alphanumeric, hyphens, underscores, and forward slashes
  if (!/^[a-zA-Z0-9/_-]+$/.test(slug)) return false;
  return true;
}

// Function to read and parse markdown file
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
    filePath,
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
      markdownCache.set(parsed.slug, parsed);
    }
  }
}

// Function to load all markdown files
async function loadAllMarkdownFiles() {
  try {
    await fs.access(CONTENT_DIR);
  } catch {
    await fs.mkdir(CONTENT_DIR, { recursive: true });
    console.log(`Created content directory at ${CONTENT_DIR}`);
  }

  markdownCache.clear();
  await loadMarkdownFilesRecursive(CONTENT_DIR);
  fileTree = await buildFileTree(CONTENT_DIR);

  console.log(`Loaded ${markdownCache.size} markdown files`);
}

// Watch for file changes
function watchMarkdownFiles() {
  const watcher = chokidar.watch(`${CONTENT_DIR}/**/*.md`, {
    persistent: true,
    ignoreInitial: true,
  });

  watcher
    .on('add', async (filePath) => {
      console.log(`File added: ${filePath}`);
      const relativePath = path.relative(CONTENT_DIR, filePath);
      const parsed = await parseMarkdownFile(filePath, relativePath);
      markdownCache.set(parsed.slug, parsed);
      fileTree = await buildFileTree(CONTENT_DIR);
    })
    .on('change', async (filePath) => {
      console.log(`File changed: ${filePath}`);
      const relativePath = path.relative(CONTENT_DIR, filePath);
      const parsed = await parseMarkdownFile(filePath, relativePath);
      markdownCache.set(parsed.slug, parsed);
      fileTree = await buildFileTree(CONTENT_DIR);
    })
    .on('unlink', (filePath) => {
      const relativePath = path.relative(CONTENT_DIR, filePath);
      const slug = relativePath.replace(/\.md$/, '').replace(/\\/g, '/');
      console.log(`File removed: ${filePath}`);
      markdownCache.delete(slug);
      buildFileTree(CONTENT_DIR).then(tree => fileTree = tree);
    });

  console.log('Watching for markdown file changes...');
}

// Routes
app.get('/', (_req: Request, res: Response) => {
  res.render('app', { fileTree });
});

app.get(/^\/page\/([a-zA-Z0-9/_-]+)$/, (_req: Request, res: Response) => {
  res.render('app', { fileTree });
});

// API endpoints with rate limiting
app.get('/api/tree', apiLimiter, (_req: Request, res: Response) => {
  res.json(fileTree);
});

app.get(/^\/api\/page\/([a-zA-Z0-9/_-]+)$/, apiLimiter, (req: Request, res: Response) => {
  const slug = req.params[0];

  // Validate slug to prevent path traversal
  if (!validateSlug(slug)) {
    return res.status(400).json({ error: 'Invalid page path' });
  }

  const page = markdownCache.get(slug);

  if (!page) {
    return res.status(404).json({ error: 'Page not found' });
  }

  res.json({
    title: page.frontmatter.title || slug,
    content: page.content,
    frontmatter: page.frontmatter,
    slug,
  });
});

app.get('/api/search', searchLimiter, (req: Request, res: Response) => {
  const query = (req.query.q as string || '').toLowerCase();

  if (!query) {
    return res.json([]);
  }

  // Limit query length to prevent DoS
  if (query.length > 100) {
    return res.status(400).json({ error: 'Query too long' });
  }

  const results = Array.from(markdownCache.values())
    .filter(page => {
      const title = (page.frontmatter.title || page.slug).toLowerCase();
      const content = page.content.toLowerCase();
      return title.includes(query) || content.includes(query);
    })
    .map(page => ({
      slug: page.slug,
      title: page.frontmatter.title || page.slug,
      description: page.frontmatter.description,
    }))
    .slice(0, 20);

  res.json(results);
});

// Initialize and start server
async function startServer() {
  await loadAllMarkdownFiles();
  watchMarkdownFiles();

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
