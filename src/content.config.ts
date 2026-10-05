import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const journal = defineCollection({
  loader: glob({ base: './src/content/journal', pattern: '**/*.md' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().max(80),
      description: z.string().max(180),
      pubDate: z.coerce.date(),
      author: z.string(),
      cover: image(),
      coverAlt: z.string(),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
    }),
});

const services = defineCollection({
  loader: glob({ base: './src/content/services', pattern: '**/*.md' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string().max(140),
      order: z.number().int(),
      cover: image(),
      coverAlt: z.string(),
      deliverables: z.array(z.string()).min(3),
      faqs: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
    }),
});

const projects = defineCollection({
  loader: glob({ base: './src/content/projects', pattern: '**/*.md' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      location: z.string(),
      year: z.number().int(),
      area: z.string(),
      client: z.string(),
      service: reference('services'),
      summary: z.string().max(160),
      cover: image(),
      coverAlt: z.string(),
      order: z.number().int(),
    }),
});

export const collections = { journal, services, projects };
