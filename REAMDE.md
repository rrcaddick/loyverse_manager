# 🎡 Farmyard Management Platform

_A unified system for bookings, ticketing, inventory automation, WhatsApp messaging, and operations._

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.10+-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/Framework-Flask-green?style=flat-square" />
  <img src="https://img.shields.io/badge/Database-MySQL-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/Dependencies-poppler--utils-critical?style=flat-square" />
</p>

---

## 🚨 System Dependency Requirement

This project **requires the system package `poppler-utils`** for PDF generation and barcode rendering.

### Installation

**Ubuntu / Debian**

```bash
sudo apt install poppler-utils
```

**CentOS / RHEL**

```bash
sudo yum install poppler-utils
```

**macOS**

```bash
brew install poppler
```

---

## ✨ Overview

The Farmyard Management Platform provides:

- **Group booking management**
- **PDF ticket generation** with QR + barcode support
- **WhatsApp dispatch** via Meta Cloud API
- **Inventory automation** integrating Loyverse, Aronium, and Quicket
- **Operational scripts** available through both CLI and the web dashboard
- **Audit tracking** for stock and payments

Built around a clean service-oriented architecture, it separates business logic, API clients, repositories, and the web layer for maintainability.

---

## 🧱 Architecture

```
├── config/
│   └── settings.py         # Environment & config loader
│
├── src/
│   ├── clients/            # External APIs (Loyverse, Quicket, PayCloud)
│   ├── services/           # Core business logic
│   ├── repositories/       # MySQL + SQLite abstraction
│   └── utils/              # Logging, dates, QR, barcodes, helpers
│
├── scripts/                # CLI automation
│   ├── add_inventory.py
│   ├── clear_inventory.py
│   └── hide_quicket_event.py
│
└── web/
    ├── routes/             # Flask controllers
    ├── templates/          # HTML (Jinja2)
    └── services/           # PDF creation, barcode tools, WhatsApp sender
```

---

## 🚀 Features

### 🚌 Group Bookings

- Create, edit, and manage group bookings
- Generate **vehicle identification ticket PDFs**
- Send tickets automatically via WhatsApp
- Scan-ready barcodes and QR codes
- MySQL-backed persistence

### 📦 Inventory Automation

- Sync Loyverse with Aronium
- Auto-adjust inventory based on Quicket ticket sales
- Manual + scheduled scripts
- Full logging and audit trail

### 🛠️ Operational Tools

- Quicket event visibility control
- Manual operation triggers from web UI
- Dedicated scripts page for secure ops

---

## 📦 Installation

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Export Environment Variables

```bash
export ENV=dev
export MYSQL_HOST="localhost"
export MYSQL_USER="root"
export MYSQL_PASSWORD="password"
export MYSQL_DB="farmyard"
export WHATSAPP_ACCESS_TOKEN="your-token"
export LOYVERSE_TOKEN="your-token"
export QUICKET_TOKEN="your-token"
```

---

## 🌐 Running the Web App

```bash
python -m web.app
```

Open:

```
http://localhost:5000
```

---

## ⚙️ Automation Scripts

### Add Inventory

```bash
python scripts/add_inventory.py
```

### Clear Inventory

```bash
python scripts/clear_inventory.py
```

### Hide a Quicket Event

```bash
python scripts/hide_quicket_event.py
```

---

## 📸 PDF Ticket Generation

Uses:

- reportlab
- qrcode
- python-barcode
- **poppler-utils** (system dependency)

---

## 🧪 Development

Enable debug logging:

```bash
export LOG_LEVEL=DEBUG
```

Run in debug mode:

```bash
flask --app web.app run --debug
```

---

## 📄 License

Private / Proprietary
