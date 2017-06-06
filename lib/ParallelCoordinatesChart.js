/**
 * Based on Parallel Coordinates example by Mike Bostock and Jason Davies
 * 
 * Modified by Cameron Tauxe
 * Version: 1.2 (June 6, 2016)
 */

/**
 * Create a parallel coordinates chart inside the given parent element
 * and using the data from the given CSV file.
 * Ignores dimensions that are in the filter
 * Calls callback when done loading.
 */
function ParallelCoordinatesChart(parent, pathToCSV, filter, callback) {
	//Init instance variables
	this.parent = parent;
	this.pathToCSV = pathToCSV;

	this.margin = {top: 30, right: 10, bottom: 10, left: 10};
	this.parentRect = parent.node().getBoundingClientRect();
	this.internalWidth = this.parentRect.width - this.margin.left - this.margin.right;
	this.internalHeight = this.parentRect.height - this.margin.top - this.margin.bottom;

	this.dispatch = d3.dispatch("selectionchange","mouseover","mouseclick");

	//xScale
	this.x = d3.scalePoint().range([0, this.internalWidth]).padding(1);
	//yScales (one for each dimension)
	this.y = {};
	//keeps track of which dimension is being dragged
	this.dragging = {};

	this.axis = d3.axisLeft();
	this.paths;

	//Create svg
	this.svg = parent.append('svg')
		.attr("class", "pCoordChart")
		.attr('viewBox',(-this.margin.right)+' '+(-this.margin.top)+' '+
						(this.parentRect.width)+' '+
						(this.parentRect.height))
		.attr('preserveAspectRatio','none')
		.attr('width','100%')
		.attr('height','100%');

	this.query;//An array of the indices of the currently selected results
	this.results;//An array of all the results (as objects)
	this.dimensions;//An array of all the dimensions
	this.filter = filter;
	this.axes;
	this.brushExtents = {};

	var self = this;
	//Load the CSV file and build chart
	d3.csv(this.pathToCSV, function(error, results) {
		self.results = results;

		//Extract the list of dimensions and create a scale for each
		self.x.domain(self.dimensions = d3.keys(results[0]).filter(function(d) {
			return filter ? !self.filter.includes(d) : true;
		}));
		self.dimensions.forEach(function(d) {
			//Add an ordinal scale if values are NaN, otherwise, use a linear scale
			if (isNaN(results[0][d])) {
				var dif = self.internalHeight/results.length;
				self.y[d] = d3.scalePoint()
					.domain(results.map(function(p){return p[d];}))
					.range([self.internalHeight,0]);
			}
			else {
				self.y[d] = d3.scaleLinear()
					.domain(d3.extent(results, function(p){return +p[d];}))
					.range([self.internalHeight, 0]);
			}
		});

		//Create result Paths
		self.paths = self.svg.append("g")
			.attr("class", "resultPaths")
		.selectAll("path")
			.data(results)
		.enter().append("path")
			.attr("index", function(d,i){return i})		
			.attr("d", function(d){return self.getPath(d)})
			.on('mouseenter', function(d,i) {
				self.setHighlight(i);
				self.dispatch.call("mouseover",self,i,d3.event)
			})
			.on('mouseleave', function(d,i) {
				self.setHighlight(null);
				self.dispatch.call("mouseover",self,null,d3.event)
			});
		//Add a group element for each dimension
		self.axes = self.svg.selectAll('.dimension')
			.data(self.dimensions)
		.enter().append('g')
			.attr('class', 'dimension')
			.attr('transform', function(d) {
				return "translate("+self.x(d)+")";
			})
			.call(d3.drag()
				.subject(function(d){return {x: self.x(d)};})
				.on('start', function(d) {
					self.dragging[d] = self.x(d);
				})
				.on('drag', function(d) {
					self.dragging[d] = Math.min(self.internalWidth, Math.max(0,d3.event.x));
					self.paths.attr("d", function(d){return self.getPath(d)});
					self.dimensions.sort(function(a, b) {
						return self.getPosition(a)-self.getPosition(b);
					});
					self.x.domain(self.dimensions);
					self.axes.attr("transform", function(d) {
						return "translate("+self.getPosition(d)+")";
					})
				})
				.on('end', function(d) {
					delete self.dragging[d];
					transition(d3.select(this)).attr("transform", "translate("+self.x(d)+")");
					transition(self.paths).attr('d',function(d){return self.getPath(d)})
			}));
		
		//Add an axis and title.
		self.axes.append("g")
			.attr("class", "axis")
			.each(function(d) {d3.select(this).call(self.axis.scale(self.y[d]));})
		.append("text")
			.style("text-anchor", "middle")
			.attr("y", -9)
			.text(function(d) {return d;});

		//Add and store a brush for each axis
		self.axes.append("g")
			.attr("class", "brush")
			.each(function(d) {
				d3.select(this).call(self.y[d].brush = d3.brushY()
										.extent([[-8,0],[8,self.internalHeight]])
										.on('start', brushstart)
										.on('start brush',function(){return self.brush()}));
			})
			.selectAll("rect")
				.attr('x', -8)
				.attr('width', 16);

		if (callback)
			callback();
		self.brush();
	});
}

/**
 * Get the path (the contents of the 'd' attribute) for the path
 * represented by the given data point
 */
ParallelCoordinatesChart.prototype.getPath = function(d) {
	var self = this;
	var curveLength = this.internalWidth/this.dimensions.length/3;
	var path = '';
	this.dimensions.map(function(p,i) {
		var x = self.getPosition(p);
		var y = self.y[p](d[p]);
		if (i == 0) {
			path += ('M '+x+' '+y+' C ')+
					((x+curveLength)+' '+y+' ');
		}
		else if (i == self.dimensions.length-1) {
			path += ((x-curveLength)+' '+y+' ')+
					(x+' '+y+' ');
		}
		else {
			path += ((x-curveLength)+' '+y+' ')+
					(x+' '+y+' ')+
					((x+curveLength)+' '+y+' ');
		}
	});
	return path;
};

/**
 * Get the x-coordinate of the axis representing the given dimension
 */
ParallelCoordinatesChart.prototype.getPosition = function(d) {
	var v = this.dragging[d];
	return v == null ? this.x(d) : v;
};

/**
 * Handle brush events. Select paths and update query
 */
ParallelCoordinatesChart.prototype.brush = function() {
	var self = this;

	//Set brush extents
	if (d3.event != null) {
		this.dimensions.forEach(function(d) {
			if (d3.event.target==self.y[d].brush) {
				if (self.y[d].step) {//Determine if ordinal scale by whether step is exposed or not
					self.brushExtents[d] = d3.event.selection;
				}
				else {
					if (d3.event.selection != null)
						self.brushExtents[d] = d3.event.selection.map(self.y[d].invert,self.y[d]);
					else
						self.brushExtents[d] = null;
				}
				if (self.brushExtents[d] != null && self.brushExtents[d][0] === self.brushExtents[d][1])
					self.brushExtents[d] = null;
			}
		});
	}

	//Iterate through paths and determine if each is selected
	//by checking that it is within the extent of each brush
	var newQuery = [];
	this.paths.each(function(d, i) {
		var selected = true;
		for (p in self.brushExtents) {
			var extent = self.brushExtents[p];
			if (self.brushExtents[p] != null) {
				if (self.y[p].step) {
					selected = selected && extent[0] <= self.y[p](d[p]) && self.y[p](d[p]) <= extent[1];
				}
				else
					selected = selected && extent[1] <= d[p] && d[p] <= extent[0];
			}
			else
				selected = selected && true;
		}
		d3.select(this).attr('mode', selected ? 'active' : 'inactive');
		if (selected)
			newQuery.push(i);
	});
	if (!arraysEqual(this.query, newQuery)) {
		this.query = newQuery;
		this.dispatch.call("selectionchange",this, this.query);
	}
};

/**
 * Redraw the chart to fit the size of its parent
 * (call this whenever its parent changes size)
 */
ParallelCoordinatesChart.prototype.updateSize = function() {
	var oldHeight = this.internalHeight;//old height needed to rescale brushes on ordinal scales

	//Recalculate dimensions
	this.parentRect = this.parent.node().getBoundingClientRect();
	this.internalWidth = this.parentRect.width - this.margin.left - this.margin.right;
	this.internalHeight = this.parentRect.height - this.margin.top - this.margin.bottom;
	this.svg.attr('viewBox',
						(-this.margin.right)+' '+
						(-this.margin.top)+' '+
						(this.parentRect.width)+' '+
						(this.parentRect.height));

	var self = this;

	//Rescale x scale
	this.x.range([0, this.internalWidth]).padding(1);

	//Rescale y scales
	this.dimensions.forEach(function(d) {
		self.y[d].range([self.internalHeight, 0]);
	});
	//Redraw paths
	this.paths.attr("d", function(d){return self.getPath(d)});

	//Reposition and rescale axes
	this.axes.attr("transform", function(d) {
						return "translate("+self.getPosition(d)+")";
					});
	this.axes.each(function(d) {
		d3.select(this).call(self.axis.scale(self.y[d]));
	});

	//Redraw brushes
	this.axes.selectAll('g.brush')
		.each(function(d) {
			self.y[d].brush
				.extent([[-8,0],[8,self.internalHeight]]);
			d3.select(this).call(self.y[d].brush);
			d3.select(this).call(self.y[d].brush.move, function() {
				if (self.brushExtents[d] == null) {return null;}
				if (self.y[d].step) {//Rescale extents for ordinal scales
					return self.brushExtents[d].map(function(i) {
						return i/oldHeight * self.internalHeight;
					})
				}
				else
					return self.brushExtents[d].map(self.y[d]);
			});
		})
}

/**
 * Highlight the path with the given index
 * Make index null to remove the highlight
 */
ParallelCoordinatesChart.prototype.setHighlight = function(index) {
	//remove previous highlight
	d3.selectAll('.resultPaths .highlightPath').remove();
	//append a highlight path that copies the path given by index
	if (index != null) {
		var path = d3.select('.resultPaths path[index="'+index+'"]');
		d3.select('.resultPaths').append('path')
			.attr('class', 'highlightPath')
			.attr('d', path.attr('d'));
	}
}

//Convenience functions

function brushstart() {
	d3.event.sourceEvent.stopPropagation();
}

function transition(g) {
	return g.transition().duration(500);
}

/**
 * Convenience function to compare arrays
 * (used to compare the query to the previous query)
 */
function arraysEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length != b.length) return false;

  for (var i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}