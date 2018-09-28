# Test Plan for Cinema:Explorer v1.9  

To test this release:

- Load a database.
- Load a database in Safari (It's "special")
- Load a database that contains NaN and undefined values.
- Load a database that is not to-spec and confirm that an error appears.
- Load a database with an axis_order.csv file.
- Load a database with an axis_order.csv file that is not to-spec and confirm that the option to select axis ordering does not appear as well as a warning in the developer console.
- Load a database while the Scatter Plot tab is selected (as opposed to the default Image Spread)
- Load a large database (300+ rows) and confirm that the pcoord and scatterPlot components switch to their respective canvas-based versions.
- Load a database while the query panel is open
- Load a database while the smoothLines checkbox is unchecked.
- Make a query with both the SVG and Canvas versions of the pcoord component.
- Select and highlight data with both the SVG and Canvas versions of the pcoord and scatterPlot components.
- Toggle "Smooth Lines" on and off with both the SVG and Canvas versions of the pcoord component.
- Change the selection while not on the first page of results in the image spread.
- Mess with all the settings in the image spread component and ensure that sorting and pagination are accurate.
