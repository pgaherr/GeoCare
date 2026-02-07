---
marp: true
theme: default_theme
paginate: true
html: true
header: " "
footer: " "
---

<!-- _class: title -->

<h1></h1>
<h2></h2>

---

# File Structure

- **main/.vscode/settings.json**  Overrides some settings to allow custom styles and embedded HTML (e.g., Folium maps). ⚠️ Careful!

- **main/themes/themes.css** Contains the theme.

- **main/config.css**  Stores logos, presentation titles, and other variables.

- **main/presentation.md**  The main Markdown presentation file.

---

# Presentation Template
- **Title Slide**: Large stacked logos appear only on the `header` element.
- **Footer**: Line, logos, title (left), presenter + page number (right).
- **Toggle**: Use `_class: light` to switch themes.
- **Aspect Ratio**: Logos are auto-sized to avoid distortion.

---

<!-- _class: light -->

# Light Theme Toggle
- Background is now white.
- Footer line, text, and pagination are black.
- Logos switch to light-mode versions.

---

# Background Image Layout

![bg brightness:0.5](https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600)

- Footer and logos sit on top of the image.
- Text remains legible thanks to the brightness filter.

---

# Interactive Folium Map

<iframe
  src="maps/mean_interval.html"
  class="map-frame">
</iframe>

--- 
<!-- _class: last -->

# Questions?
## Thank you.

Someone's name
Contact: name@email.com
