# 🏥 Hospital Management System

A modern, real-time hospital management system with doctor-patient communication, patient vital monitoring, and role-based dashboards.

## Features

### 🔐 Authentication & Authorization
- Secure login system with JWT tokens
- 4 user roles: Doctor, Staff/Nurse, Admin, Patient
- Role-based access control
- Session management

### 👥 User Roles & Dashboards

#### **Doctor Dashboard**
- View assigned patients with real-time vitals
- Monitor patient severity levels (Critical, Severe, Moderate, Mild)
- Track patient medical codes and diagnosis
- Doctor-to-doctor consultations via chat
- Real-time patient updates

#### **Staff/Nurse Dashboard**
- View all hospital patients
- Update and monitor patient vitals
- Patient list management by department
- Real-time vital signs synchronization

#### **Admin Dashboard**
- System administration panel
- User management (Add, view, manage staff)
- Patient management and statistics
- System-wide analytics and monitoring
- Hospital operations oversight

#### **Patient Dashboard**
- Personal health information access
- Real-time communication with assigned doctor
- Medical history and treatment status
- Receive health updates and notifications

### 📊 Patient Management
- Complete patient profiles with unique codes
- Patient admission and discharge tracking
- 4-level severity classification (Critical/Severe/Moderate/Mild)
- Real-time vital signs monitoring (Temp, BP, HR, RR)
- Medical history and clinical notes
- Doctor and staff assignment tracking

### 💬 Communication System
- Doctor-to-Doctor consultation chat
- Doctor-to-Patient messaging
- Staff-to-Doctor updates
- Real-time message delivery via WebSocket
- Multi-user group conversations

### 🔔 Real-Time Updates
- WebSocket-based live patient data sync
- Automatic vital sign notifications
- Severity alert system
- Multi-user activity feed
- Instant message delivery

## Technology Stack

### Backend
- **PHP (XAMPP Apache)** - RESTful API handling
- **JWT** - Secure authentication tokens
- **MySQL** - Primary data persistence

### Frontend
- **HTML5** - Semantic markup
- **CSS3** - Responsive and modern styling
- **Vanilla JavaScript** - Interactive functionality
- **WebSocket API** - Real-time communication
- **LocalStorage** - Client-side session management

## Installation & Setup

### Prerequisites
- XAMPP (Apache + PHP)
- Modern web browser with WebSocket support

### Quick Start

1. Put the project folder inside your XAMPP `htdocs` directory.
2. Start Apache from the XAMPP Control Panel.
3. Open the app in browser:

`http://localhost/clinic-appointment-system/src/index.html`

## XAMPP Deployment (Recommended)

This project is configured to run locally with XAMPP only.

1. Put the project folder inside your XAMPP `htdocs` directory.
2. Start Apache from the XAMPP Control Panel.
3. Open the app from your browser using your local project URL, for example:
   - `http://localhost/clinic-appointment-system/src/index.html`

### API Base Configuration

`src/js/runtime-config.js` now auto-detects your local project path and points to:

- `http://localhost/<project-folder>/api`

No additional third-party deployment or messaging setup is required.

## Default Login Credentials

### Doctor
- **Username:** muhammad.irfan
- **Password:** password123
- **Department:** Cardiology

### Doctor 2
- **Username:** afif.wahdi
- **Password:** password123
- **Department:** Psychiatry

### Doctor 3
- **Username:** aizul.eirfan
- **Password:** password123
- **Department:** Neuro-Oftalmology

### Staff/Nurse
- **Username:** staff1
- **Password:** password123
- **Department:** General Ward

### Admin
- **Username:** admin
- **Password:** password123

### Patient
- **Username:** patient1
- **Password:** password123

## API Documentation

### Authentication Endpoints
- `POST /api/auth/login` - User login (returns JWT token)
- `POST /api/auth/register` - New user registration
- `POST /api/auth/verify` - Verify JWT token validity

### Patient Management
- `GET /api/patients` - List all patients
- `GET /api/patients/:id` - Get patient details
- `GET /api/patients/doctor/:doctorId` - Get doctor's patients
- `POST /api/patients` - Admit new patient
- `PUT /api/patients/:id` - Update patient info
- `PUT /api/patients/:id/vitals` - Update vitals
- `PUT /api/patients/:id/severity` - Change severity level
- `DELETE /api/patients/:id` - Discharge patient

### User Management
- `GET /api/users` - List all users (admin)
- `GET /api/users/role/doctor` - Get all doctors
- `GET /api/users/role/staff` - Get all staff
- `GET /api/users/:id` - Get user details
- `PUT /api/users/:id` - Update user info

### Messaging
- `GET /api/messages` - Get user's messages
- `GET /api/messages/conversation/:otherUserId` - Get conversation
- `POST /api/messages` - Send message
- `PUT /api/messages/:id/read` - Mark as read

## Patient Data Structure

```javascript
{
    id: 1,                           // Unique patient ID
    name: 'Ali',                     // Full name
    patientCode: 'ALI-001',          // Unique hospital code
    age: 45,
    gender: 'Male',
    bloodType: 'O+',
    phone: '+60123456789',
    email: 'ali@email.com',
    address: '123 Jln Merdeka',
    diagnosis: 'Fever',
    severity: 'Moderate',            // Critical|Severe|Moderate|Mild
    admittedDate: '2026-07-10',
    assignedDoctor: 1,               // Doctor user ID
    assignedStaff: 3,                // Staff user ID
    vitals: {
        temperature: 38.5,           // Celsius
        bloodPressure: '120/80',      // mmHg
        heartRate: 85,               // bpm
        respiratoryRate: 18,         // breaths/min
        lastUpdated: '2026-07-14T...'
    },
    notes: 'Patient admitted with fever',
    createdAt: '2026-07-10T...'
}
```

## Severity Level Guide

| Level | Status | Color | Response Required |
|-------|--------|-------|-------------------|
| **Critical** | 🔴 | Red | Immediate intervention |
| **Severe** | 🟠 | Orange | Urgent attention |
| **Moderate** | 🟡 | Yellow | Ongoing monitoring |
| **Mild** | 🟢 | Green | Routine care |

## Project Structure

```
clinic-appointment-system/
├── server.js                   # Express server & WebSocket
├── server/
│   ├── db.js                  # JSON data storage module
│   ├── middleware/
│   │   └── auth.js            # JWT authentication
│   ├── routes/
│   │   ├── auth.js            # Login/register
│   │   ├── patients.js        # Patient CRUD
│   │   ├── users.js           # User management
│   │   └── messages.js        # Messaging system
│   └── data/                  # JSON database files
├── src/
│   ├── index.html             # Login page
│   ├── dashboard.html         # Main dashboard
│   ├── css/styles.css         # Application styles
│   ├── js/
│   │   ├── auth.js            # Login logic
│   │   └── dashboard.js       # Dashboard logic
│   └── pages/                 # Legacy pages
└── README.md                  # This file
```

## WebSocket Real-Time Events

### Patient Updated
```javascript
{
    type: 'patient-updated',
    patient: {...},
    updatedBy: userId,
    timestamp: '2026-07-14T10:30:00Z'
}
```

### Vitals Updated
```javascript
{
    type: 'vitals-updated',
    patient: {...},
    updatedBy: userId,
    timestamp: '2026-07-14T10:30:00Z'
}
```

### Severity Alert
```javascript
{
    type: 'severity-updated',
    patientId: 3,
    patientName: 'Rajesh',
    severity: 'Severe',
    updatedBy: 'Dr. Muhammad Irfan',
    timestamp: '2026-07-14T10:30:00Z'
}
```

### New Message
```javascript
{
    type: 'message',
    message: {
        id: 1,
        senderId: 1,
        senderName: 'Dr. Muhammad Irfan',
        recipientId: 2,
        content: 'How is the patient?',
        timestamp: '2026-07-14T10:30:00Z'
    }
}
```

## Security Considerations

⚠️ **Development Only** - For production deployment:

1. **Passwords**: Hash using bcryptjs, don't store plain text
2. **Secrets**: Move JWT secret to environment variables (.env)
3. **HTTPS**: Always use HTTPS in production
4. **Database**: Harden MySQL privileges and backup strategy
5. **CORS**: Configure proper CORS headers
6. **Validation**: Add comprehensive input validation
7. **Rate Limiting**: Implement API rate limiting
8. **WSS**: Use secure WebSocket (wss://) protocol
9. **Audit Logs**: Log all sensitive operations
10. **OWASP**: Follow OWASP security guidelines

## Troubleshooting

### Server won't start
```bash
# Check if port 3000 is in use
netstat -ano | findstr :3000
# Kill process or change PORT in server.js
```

### WebSocket connection failed
- Ensure server is running
- Check firewall settings
- Verify browser console for errors

### Login not working
- Check browser console for network errors
- Verify credentials match default credentials
- Clear browser cache/localStorage

### Database reset
- Use phpMyAdmin to truncate application tables in your local MySQL database
- Restart Apache from XAMPP Control Panel

## Future Enhancements

- [ ] Full database integration (PostgreSQL/MongoDB)
- [ ] Email/SMS notifications
- [ ] Appointment scheduling
- [ ] Lab results management
- [ ] Prescription system
- [ ] Video consultations
- [ ] Mobile application
- [ ] Advanced analytics
- [ ] Medical records encryption
- [ ] Insurance integration
- [ ] Telemedicine features
- [ ] Patient portal improvements

## Development Commands

Use XAMPP Control Panel for runtime operations:

- Start Apache
- Stop Apache
- Restart Apache

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Performance Tips

1. **Optimize images** - Reduce file sizes
2. **Lazy load** - Load data on demand
3. **Cache API calls** - Store frequent requests
4. **Minify CSS/JS** - Reduce file sizes
5. **Use CDN** - For static assets

## Contributing

Contributions are welcome! Please ensure:
- Code follows project style
- Features are tested
- Documentation is updated
- Pull requests are descriptive

## License

MIT License - Free for educational and commercial use

## Support & Contact

For support or issues:
1. Check the troubleshooting section
2. Review browser console logs
3. Check server terminal output
4. Consult the API documentation

---

**Hospital Management System v2.0.0**
Real-time patient monitoring and healthcare team collaboration
Built with Node.js, Express, and WebSocket

- Check the doctors page for information about available doctors.
- Use the contact page to reach out to the clinic for any inquiries.

## Contributing
Contributions are welcome! Please submit a pull request or open an issue for any suggestions or improvements.# clinic-appoiment-system
#   c l i n i c - a p p o i m e n t  
 #   c l i n i c - a p p o i m e n t  
 