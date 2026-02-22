from PIL import Image, ImageDraw, ImageFont
import os

def create_placeholder_logo():
    # Create directory if not exists
    os.makedirs('static/images', exist_ok=True)
    
    # Create a 200x200 image with white background
    img = Image.new('RGB', (200, 200), color = (255, 255, 255))
    d = ImageDraw.Draw(img)
    
    # Draw a blue circle (pin base)
    d.ellipse([50, 50, 150, 150], fill=(0, 123, 255))
    
    # Draw text
    # text = "Nearva"
    # d.text((10,10), text, fill=(0,0,0))
    
    # Save the image
    img.save('static/images/nearva_logo.png')
    print("Placeholder logo created at static/images/nearva_logo.png")

if __name__ == "__main__":
    try:
        create_placeholder_logo()
    except ImportError:
        print("Pillow library not found. Installing...")
        import subprocess
        subprocess.check_call(["pip", "install", "Pillow"])
        from PIL import Image, ImageDraw
        create_placeholder_logo()
