---
title: Introducing BaseNative
slug: basenative-launch
date: 2026-04-15
tags: [basenative, ecosystem, announcement]
excerpt: We're excited to announce the launch of BaseNative, a modular web framework built on zero-dependency principles.
---

## A Fresh Approach to Web Development

Today we're launching **BaseNative**, a modular, zero-dependency JavaScript framework designed for developers who want control without complexity. BaseNative puts signal-based reactivity at the core, enabling efficient state management and rendering across the entire stack.

### What's Included

BaseNative ships with a comprehensive ecosystem of packages:

- **@basenative/runtime** — Signal-based state management (~120 lines, zero deps)
- **@basenative/server** — SSR engine with streaming support
- **@basenative/router** — Path routing with view transitions
- **@basenative/components** — 15+ semantic UI components
- **@basenative/forms** — Form state and validation
- **@basenative/auth** — Session management and RBAC
- **@basenative/db** — Query builder with multiple adapters

### Why Zero Dependencies?

We believe in explicit, transparent code. No hidden dependencies means faster load times, better security audits, and complete control over your dependencies tree. Every package is lean and focused on solving one problem well.

### Get Started

Documentation and examples are available at [basenative.dev](https://basenative.dev). Start with the CLI scaffolder to bootstrap a new project.

```bash
npx create-basenative@latest my-app
```

Welcome to the BaseNative ecosystem!
