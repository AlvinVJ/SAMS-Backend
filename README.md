# SAMS-Backend (Student Activity Management System)

A robust, enterprise-grade backend infrastructure designed to automate administrative workflows and approval processes.

## 🚀 Core Features

- **Dynamic Workflow Engine**: Flexible procedure definition system allowing custom form fields and multi-level approval stages.
- **Context-Aware Role Resolution**: 
    - Automated resolution of HODs, Class Advisors, and Wardens.
    - **Club Context Resolution**: Intelligent mapping of `club_coordinator` and `club_lead` roles based on the requester's membership.
- **System Hooks**: Automated bulk processing for critical events (e.g., Placement Attendance, Overnight Hostel Notifications) with configurable execution timing (`START` vs `END`).
- **Hybrid Data Architecture**: Leverages PostgreSQL (via Prisma) for relational integrity and Firestore for high-frequency request state management.
- **Event-Driven Task Queue**: SQS-backed workers for reliable notification delivery and background processing.

## 🛠️ Technology Stack

- **Runtime**: Node.js with TypeScript
- **Database**: PostgreSQL (Relational), Firestore (NoSQL)
- **ORM**: Prisma
- **Cloud/Services**: Supabase (Storage), AWS SQS (Message Queue), Firebase Admin SDK
- **Web Framework**: Express.js
