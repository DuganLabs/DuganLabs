---
title: BaseNative Ecosystem Q2 Update
slug: ecosystem-update-q2
date: 2026-04-20
tags: [basenative, ecosystem, update]
excerpt: A look at what's shipping in Q2 2026 — marketplace, real-time APIs, and major performance improvements.
---

## Q2 2026 Roadmap Highlights

As BaseNative grows, we're focusing on three key areas: **discoverability**, **real-time communication**, and **developer experience**. Here's what's coming.

### Community Marketplace (Live Now)

The **@basenative/marketplace** package is now available. It provides a registry client and component installer so you can discover and install community-built components directly into your projects.

```javascript
import { installComponent } from '@basenative/marketplace';
await installComponent('some-org/card-component');
```

### Real-Time APIs (Shipping This Week)

**@basenative/realtime** combines SSE, WebSocket, and a channel manager for seamless real-time communication. Use it for live notifications, collaborative editing, and streaming data.

```javascript
const channel = realtime.subscribe('chat:room-id');
channel.on('message', (msg) => console.log(msg));
```

### Performance Improvements

The latest @basenative/runtime update reduces signal tracking overhead by 40%. Projects using computed signals see measurable improvements in render time.

### What's Next

In Q3, we're launching the **Cowork plugin system** for extending the developer experience and **Feature flags** via Cloudflare KV for seamless edge deployments.

Thank you for being part of the BaseNative journey!
