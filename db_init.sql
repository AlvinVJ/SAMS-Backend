CREATE TABLE table_name(  
    id int IDENTITY(1,1) primary key,
    create_time DATETIME,
    update_time DATETIME,
    content NVARCHAR(255)
);
EXECUTE sp_addextendedproperty N'MS_Description', '[table_comment]', N'user', N'dbo', N'table', N'[table_name]', NULL, NULL;
EXECUTE sp_addextendedproperty N'MS_Description', '[column_comment]', N'user', N'dbo', N'table', N'[table_name]', N'column', N'[column_name]';

/*trial*/


CREATE TABLE UserTypes (
  user_type_id INT PRIMARY KEY,
  user_type_tag NVARCHAR(50) UNIQUE NOT NULL,
  description NVARCHAR(255),
  is_active BIT NOT NULL DEFAULT 1
);
INSERT INTO UserTypes VALUES
(0, 'STUDENT', 'Enrolled student', 1),
(1, 'FACULTY', 'Teaching or academic staff', 1),
(2, 'ADMIN', 'System / office admin', 1),
(3, 'CLUB_LEAD', 'Student Club Leaders', 1),
(4, 'PLACEMENT_COORDINATOR', 'Faculty Placement Team', 1);

CREATE TABLE Batches (
  batch_id INT PRIMARY KEY,
  batch NVARCHAR(50) NOT NULL,
  is_active BIT NOT NULL DEFAULT 1,
  deleted_at DATETIME2 NULL
);

CREATE INDEX IDX_Batches_Active ON Batches(is_active);

CREATE TABLE Departments (
  dept_id INT PRIMARY KEY,
  dept_name NVARCHAR(100) NOT NULL,
  is_active BIT NOT NULL DEFAULT 1,
  deleted_at DATETIME2 NULL
);

CREATE INDEX IDX_Departments_Active ON Departments(is_active);

CREATE TABLE Roles (
  role_id INT PRIMARY KEY,
  role_tag NVARCHAR(50) NOT NULL UNIQUE,
  role_desc NVARCHAR(255),
  is_active BIT NOT NULL DEFAULT 1,
  deleted_at DATETIME2 NULL
);

CREATE INDEX IDX_Roles_Active ON Roles(is_active);

CREATE TABLE UserAccount (
  mits_uid NVARCHAR(50) NOT NULL,
  auth_uid NVARCHAR(100) NOT NULL,
  user_type INT NOT NULL,
  is_active BIT NOT NULL DEFAULT 1,
  deleted_at DATETIME2 NULL,

  CONSTRAINT PK_UserAccount
    PRIMARY KEY (mits_uid),

  CONSTRAINT UQ_UserAccount_AuthUid
    UNIQUE (auth_uid),

  CONSTRAINT FK_UserAccount_UserType
    FOREIGN KEY (user_type)
    REFERENCES UserTypes(user_type_id)
);

CREATE INDEX IDX_UserAccount_Active
ON UserAccount (is_active);

CREATE INDEX IDX_UserAccount_UserType
ON UserAccount (user_type);


CREATE TABLE Classes (
  class_id INT PRIMARY KEY,
  batch_id INT NOT NULL,
  class NVARCHAR(50) NOT NULL,
  dept_id INT NOT NULL,
  is_active BIT NOT NULL DEFAULT 1,
  deleted_at DATETIME2 NULL,

  CONSTRAINT FK_Classes_Batch
    FOREIGN KEY (batch_id) REFERENCES Batches(batch_id),

  CONSTRAINT FK_Classes_Department
    FOREIGN KEY (dept_id) REFERENCES Departments(dept_id)
);

CREATE INDEX IDX_Classes_Active ON Classes(is_active);
CREATE INDEX IDX_Classes_Batch ON Classes(batch_id);

CREATE TABLE Student (
  mits_uid NVARCHAR(50) PRIMARY KEY,
  name NVARCHAR(100) NOT NULL,
  batch_id INT NOT NULL,
  class_id INT NOT NULL,
  hosteller BIT NOT NULL,
  gender CHAR(1),
  phone NVARCHAR(15) UNIQUE,
  is_active BIT NOT NULL DEFAULT 1,
  deleted_at DATETIME2 NULL,

  CONSTRAINT FK_Student_User
    FOREIGN KEY (mits_uid) REFERENCES UserAccount(mits_uid),

  CONSTRAINT FK_Student_Batch
    FOREIGN KEY (batch_id) REFERENCES Batches(batch_id),

  CONSTRAINT FK_Student_Class
    FOREIGN KEY (class_id) REFERENCES Classes(class_id)
);

CREATE INDEX IDX_Student_Active ON Student(is_active);
CREATE INDEX IDX_Student_Class ON Student(class_id);

CREATE TABLE Faculty (
  mits_uid NVARCHAR(50) PRIMARY KEY,
  name NVARCHAR(30) NOT NULL,
  department_id INT NOT NULL,
  email NVARCHAR(50) UNIQUE,
  is_active BIT NOT NULL DEFAULT 1,
  deleted_at DATETIME2 NULL,

  CONSTRAINT FK_Faculty_User
    FOREIGN KEY (mits_uid) REFERENCES UserAccount(mits_uid),

  CONSTRAINT FK_Faculty_Department
    FOREIGN KEY (department_id) REFERENCES Departments(dept_id)
);

CREATE INDEX IDX_Faculty_Active ON Faculty(is_active);
CREATE INDEX IDX_Faculty_Department ON Faculty(department_id);

CREATE TABLE RoleMapping (
  role_mapping_id INT PRIMARY KEY,
  role_id INT NOT NULL,
  mits_uid NVARCHAR(50) NOT NULL,
  is_active BIT NOT NULL DEFAULT 1,
  deleted_at DATETIME2 NULL,

  CONSTRAINT FK_RoleMapping_Role
    FOREIGN KEY (role_id) REFERENCES Roles(role_id),

  CONSTRAINT FK_RoleMapping_User
    FOREIGN KEY (mits_uid) REFERENCES UserAccount(mits_uid)
);

CREATE INDEX IDX_RoleMapping_Active ON RoleMapping(is_active);
CREATE INDEX IDX_RoleMapping_User ON RoleMapping(mits_uid);

CREATE TABLE ClassFaculty (
  class_id INT NOT NULL,
  mits_uid NVARCHAR(50) NOT NULL,
  role_tag NVARCHAR(50) NOT NULL,
  is_active BIT NOT NULL DEFAULT 1,
  deleted_at DATETIME2 NULL,

  CONSTRAINT PK_ClassFaculty
    PRIMARY KEY (class_id, mits_uid, role_tag),

  CONSTRAINT FK_ClassFaculty_Class
    FOREIGN KEY (class_id) REFERENCES Classes(class_id),

  CONSTRAINT FK_ClassFaculty_Faculty
    FOREIGN KEY (mits_uid) REFERENCES Faculty(mits_uid),

  CONSTRAINT FK_ClassFaculty_Role
    FOREIGN KEY (role_tag) REFERENCES Roles(role_tag)
);

CREATE INDEX IDX_ClassFaculty_Active ON ClassFaculty(is_active);

CREATE TABLE Clubs (
  club_id INT PRIMARY KEY,
  club_name NVARCHAR(50) NOT NULL,
  dept_id INT,
  coordinator_role_tag NVARCHAR(50),
  is_active BIT NOT NULL DEFAULT 1,
  deleted_at DATETIME2 NULL,

  CONSTRAINT FK_Clubs_Department
    FOREIGN KEY (dept_id) REFERENCES Departments(dept_id),

  CONSTRAINT FK_Clubs_CoordinatorRole
    FOREIGN KEY (coordinator_role_tag) REFERENCES Roles(role_tag)
);

CREATE INDEX IDX_Clubs_Active ON Clubs(is_active);

CREATE TABLE ClubAdmin (
  club_admin_id INT PRIMARY KEY,
  club_id INT NOT NULL,
  role_tag NVARCHAR(50) NOT NULL,
  is_active BIT NOT NULL DEFAULT 1,
  deleted_at DATETIME2 NULL,

  CONSTRAINT FK_ClubAdmin_Club
    FOREIGN KEY (club_id) REFERENCES Clubs(club_id),

  CONSTRAINT FK_ClubAdmin_Role
    FOREIGN KEY (role_tag) REFERENCES Roles(role_tag)
);

CREATE INDEX IDX_ClubAdmin_Active ON ClubAdmin(is_active);

CREATE TABLE Analytics (
  mits_uid NVARCHAR(50) NOT NULL,
  role_id INT NOT NULL,
  pending INT DEFAULT 0,
  approved INT DEFAULT 0,
  rejected INT DEFAULT 0,

  CONSTRAINT PK_Analytics
    PRIMARY KEY (mits_uid, role_id),

  CONSTRAINT FK_Analytics_Faculty
    FOREIGN KEY (mits_uid) REFERENCES Faculty(mits_uid),

  CONSTRAINT FK_Analytics_Role
    FOREIGN KEY (role_id) REFERENCES Roles(role_id)
);

CREATE TABLE Procedures (
  proc_id NVARCHAR(50) PRIMARY KEY,
  title NVARCHAR(255) NOT NULL,
  desc_first_50_char NVARCHAR(50),
  is_active BIT NOT NULL DEFAULT 1,
  deleted_at DATETIME2 NULL,
  created_by NVARCHAR(50)
);

CREATE INDEX IDX_Procedures_Active ON Procedures(is_active);

CREATE TABLE ProcedureVisibility (
  proc_id NVARCHAR(50) NOT NULL,
  user_type INT NOT NULL,

  CONSTRAINT PK_ProcedureVisibility
    PRIMARY KEY (proc_id, user_type),

  CONSTRAINT FK_ProcedureVisibility_Procedure
    FOREIGN KEY (proc_id) REFERENCES Procedures(proc_id)
);


CREATE TABLE Requests (
  req_id NVARCHAR(50) PRIMARY KEY,
  proc_id NVARCHAR(50) NOT NULL,
  created_by NVARCHAR(50) NOT NULL,
  created_at DATETIME2 DEFAULT SYSDATETIME(),
  status INT NOT NULL,

  CONSTRAINT FK_Requests_Procedure
    FOREIGN KEY (proc_id) REFERENCES Procedures(proc_id),

  CONSTRAINT FK_Requests_User
    FOREIGN KEY (created_by) REFERENCES UserAccount(mits_uid)
);

CREATE INDEX IDX_Requests_Procedure ON Requests(proc_id);
CREATE INDEX IDX_Requests_CreatedBy ON Requests(created_by);
