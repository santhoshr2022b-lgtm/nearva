from flask import Flask, render_template, request, redirect, url_for, jsonify, session, flash
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'nearva_super_secret_key'  # Required for sessions
# Configure SQLite database
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///nearva.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Database Model
class Worker(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20), nullable=False)
    service = db.Column(db.String(50), nullable=False)
    experience = db.Column(db.Integer, nullable=False)
    area = db.Column(db.String(100), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    # Changed from Boolean to String to match request
    availability = db.Column(db.String(20), default='Available') 
    approval_status = db.Column(db.String(20), default='Pending') # Pending, Approved, Rejected
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'phone': self.phone,
            'service': self.service,
            'experience': self.experience,
            'area': self.area,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'availability': self.availability,
            'approval_status': self.approval_status
        }

# Routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route("/<city>/<service>")
def service_city_page(city, service):
    return render_template(
        "service_city.html",
        city=city.capitalize(),
        service=service.replace("-", " ").title()
    )

@app.route('/map')
def map_view():
    return render_template('map.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        try:
            avail = 'Available' if request.form.get('availability') else 'Busy'
            new_worker = Worker(
                name=request.form['name'],
                phone=request.form['phone'],
                service=request.form['service'],
                experience=int(request.form['experience']),
                area=request.form['area'],
                latitude=float(request.form['latitude']),
                longitude=float(request.form['longitude']),
                availability=avail
            )
            db.session.add(new_worker)
            db.session.commit()
            return redirect(url_for('index')) # Redirect to home
        except Exception as e:
            return f"An error occurred: {e}"
    return render_template('register.html')

# Admin Routes
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        password = request.form.get('password')
        if password == 'admin123': # Simple hardcoded password
            session['logged_in'] = True
            return redirect(url_for('admin'))
        else:
            flash('Invalid Password')
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app.route('/admin')
def admin():
    if not session.get('logged_in'):
        return redirect(url_for('login'))
        
    workers = Worker.query.order_by(Worker.created_at.desc()).all()
    return render_template('admin.html', workers=workers)

@app.route('/admin/delete/<int:id>', methods=['POST'])
def delete_worker(id):
    if not session.get('logged_in'):
        return jsonify({'success': False}), 401
    worker = Worker.query.get_or_404(id)
    db.session.delete(worker)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/workers')
def get_workers():
    # Only return approved workers for the map
    workers = Worker.query.filter_by(approval_status='Approved').all()
    return jsonify([worker.to_dict() for worker in workers])

@app.route('/api/worker/<int:id>/status', methods=['POST'])
def update_worker_status(id):
    if not session.get('logged_in'):
        return jsonify({'success': False}), 401
        
    worker = Worker.query.get_or_404(id)
    status = request.json.get('status')
    if status in ['Approved', 'Rejected', 'Pending']:
        worker.approval_status = status
        db.session.commit()
        return jsonify({'success': True})
    return jsonify({'success': False}), 400

# Worker Dashboard API Routes
@app.route('/worker/login', methods=['GET', 'POST'])
def worker_login():
    if request.method == 'GET':
        return render_template('worker_login.html')
    
    # API Login
    data = request.json
    phone = data.get('phone')
    worker = Worker.query.filter_by(phone=phone).first()
    
    if worker:
        return jsonify({
            'success': True,
            'id': worker.id,
            'name': worker.name,
            'status': worker.approval_status
        })
    return jsonify({'success': False, 'message': 'Worker not found'}), 404

@app.route('/api/worker/status/<int:id>')
def check_worker_status(id):
    worker = Worker.query.get(id)
    if worker:
        return jsonify({
            'status': 'success',
            'worker': {
                'name': worker.name,
                'status': worker.approval_status,
                'availability': worker.availability
            }
        })
    return jsonify({'status': 'error', 'message': 'Worker not found'}), 404

@app.route('/api/worker/update', methods=['POST'])
def update_location():
    try:
        worker_id = request.form.get('id')
        lat = request.form.get('latitude')
        lng = request.form.get('longitude')
        availability = request.form.get('availability')

        worker = Worker.query.get(worker_id)
        if worker:
            if lat and lng:
                worker.latitude = float(lat)
                worker.longitude = float(lng)
            
            if availability:
                worker.availability = availability
                
            db.session.commit()
            return jsonify({'success': True})
        return jsonify({'success': False, 'message': 'Worker not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Initialize Database
with app.app_context():
    db.create_all()

if __name__ == '__main__':
    app.run(debug=True)
