# 🛍️ Found You A Deal!
### *Your AI-powered personal deal-finding assistant.*

Found You A Deal is a full-stack, AI-powered application that automatically scans the web for fresh deals, evaluates them with an ensemble of pricing models, and saves the best ones for you. It’s built with agentic AI, RAG search, and a serverless-first architecture.

---

## 🚀 Features

### 🔎 Automated Deal Scanning
- Continuously scans major deal sources through RSS feeds  
- Extracts titles, descriptions, prices, and URLs  
- Cleans and parses messy HTML product descriptions  

### 🤖 Smart Pricing (AI Ensemble)
A two-model ensemble accurately predicts fair prices:

- **70% Modal-hosted Llama model** (fine-tuned for pricing)  
- **30% GPT-4o-mini with RAG** (searches 400k+ historical products using pgvector)

Fallback logic ensures the system **always returns a prediction**, even if one model fails.

### 📚 RAG + Vector Database
- PostgreSQL + pgvector stores embeddings for 400k+ products  
- Cosine similarity search finds similar items instantly  
- Enables accurate GPT price predictions based on real historical data  

### 🗂️ Agentic Pipeline
The app uses an automated agent flow:

1. **ScannerAgent** → Scans RSS feeds  
2. **PricingAgent** → Predicts fair prices  
3. **PlanningAgent** → Orchestrates the pipeline & saves deals  

Runs on a schedule with zero manual work.

### 🔐 Authentication
- Email + password login  
- BetterAuth for typed, secure authentication  
- Cookie-based, persistent sessions  

### 🌐 Modern Web App
- Built with **Next.js 14** (App Router)  
- Tailwind + shadcn UI components  
- Dashboard listing deals  
- Serverless functions for AI & data processing  

---

## 🏗️ Tech Stack

### **Frontend**
- Next.js 14  
- React  
- Tailwind CSS  
- shadcn/ui  

### **Backend**
- Serverless Functions (Vercel / Edge)  
- Modal Serverless GPU for Llama  
- OpenAI GPT-4o-mini for RAG  

### **Database**
- PostgreSQL  
- Prisma ORM  
- pgvector for embeddings  

### **AI / ML**
- Fine-tuned Llama model via Modal  
- GPT-4o-mini with Retrieval-Augmented Generation  
- 400k+ vector embeddings  

### **Agents**
- `ScannerAgent`  
- `PricingAgent`  
- `PlanningAgent`  

---

## 🧩 How It Works (Simple Overview)

1. **ScannerAgent** reads RSS feeds containing fresh deals.  
2. It extracts the product title, price, and URL.  
3. **PricingAgent** evaluates each item using:  
   - Llama prediction (70%)  
   - GPT + RAG prediction (30%)  
4. Produces a *fair price*, discount %, and confidence score.  
5. **PlanningAgent** saves everything to the database.  
6. Dashboard displays the best deals to the user.

---
