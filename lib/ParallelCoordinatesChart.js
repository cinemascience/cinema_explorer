/**
 * Based on Parallel Coordinates example by Mike Bostock and Jason Davies
 * 
 * Modified by Cameron Tauxe
 * Version: 1.0 (June 1, 2016)
 */

/**
 * Create a parallel coordinates chart inside the given parent element
 * and using the data from the given CSV file.
 * Ignores dimensions that are in the filter
 * Calls callback when done loading.
 * Calls selectionChanged each time the selection changes with the query as an argument
 * Calls mouseOverChanged every time the user mouses over a path with its index as an argument
 */
function ParallelCoordinatesChart(parent, pathToCSV, doneLoading, selectionChanged, mouseOverChanged, filter) {
	//Init instance variables
	this.parent = parent;
	this.pathToCSV = pathToCSV;
	this.selectionChanged = selectionChanged;
	this.mouseOverChanged = mouseOverChanged;

	this.margin = {top: 30, right: 10, bottom: 10, left: 10};
	this.parentRect = parent.node().getBoundingClientRect();
	this.internalWidth = this.parentRect.width - this.margin.left - this.margin.right;
	this.internalHeight = this.parentRect.height - this.margin.top - this.margin.bottom;

	//xScale
	this.x = d3.scale.ordinal().rangePoints([0, this.internalWidth], 1);
	//yScales (one for each dimension)
	this.y = {};
	//keeps track of which dimension is being dragged
	this.dragging = {};

	this.line = d3.svg.line().interpolate('cardinal-open').tension(0.85);
	this.axis = d3.svg.axis().orient("left");
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

	var self = this;
	//Load the CSV file and build chart
	d3.csv(this.pathToCSV, function(error, results) {
		self.results = results;

		//Extract the list of dimensions and create a scale for each
		self.x.domain(self.dimensions = d3.keys(results[0]).filter(function(d) {
			return filter ? !self.filter.includes(d) : true;
		}));
		for (i in self.dimensions) {
			var d = self.dimensions[i];
			self.y[d] = d3.scale.linear()
				.domain(d3.extent(results, function(p){return +p[d];}))
				.range([self.internalHeight, 0]);
		}

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
				if (mouseOverChanged)
					mouseOverChanged(i, d3.event);
			})
			.on('mouseleave', function(d,i) {
				self.setHighlight(null);
				if (mouseOverChanged)
					mouseOverChanged(null, d3.event);
			});
		//Add a group element for each dimension
		self.axes = self.svg.selectAll('.dimension')
			.data(self.dimensions)
		.enter().append('g')
			.attr('class', 'dimension')
			.attr('transform', function(d) {
				return "translate("+self.x(d)+")";
			})
			.call(d3.behavior.drag()
				.origin(function(d){return {x: self.x(d)};})
				.on('dragstart', function(d) {
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
				.on('dragend', function(d) {
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
				d3.select(this).call(self.y[d].brush = d3.svg.brush().y(self.y[d])
										.on('brushstart', brushstart)
										.on('brush',function(){return self.brush()}));
			})
			.selectAll("rect")
				.attr('x', -8)
				.attr('width', 16);

		if (doneLoading)
			doneLoading();
		self.brush();
	});
}

/**
 * Get the path (the contents of the 'd' attribute) for the path
 * represented by the given data point
 */
ParallelCoordinatesChart.prototype.getPath = function(d) {
	var self = this;
	/*return this.line(this.dimensions.map(function(p) {
		return [self.getPosition(p), self.y[p](d[p])];
	}));*/
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
	var actives = this.dimensions.filter(function(p){return !self.y[p].brush.empty();}),
		extents = actives.map(function(p){return self.y[p].brush.extent();});

	var newQuery = [];
	this.paths.each(function(d,i) {
		var sel = actives.every(function(p,i) {
			return extents[i][0] <= d[p] && d[p] <= extents[i][1];
		})
		d3.select(this).attr('mode', sel ? 'active' : 'inactive');
		if (sel)
			newQuery.push(i);
	})
	//var opacity = Math.min(2/Math.pow(this.query.length,0.3),1);
	//d3.selectAll('.resultPaths path[mode="active"]').style('stroke-opacity',opacity);
	if (!arraysEqual(this.query, newQuery)) {
		this.query = newQuery;
		if (this.selectionChanged)
			this.selectionChanged(this.query);
	}
};

/**
 * Redraw the chart to fit the size of its parent
 * (call this whenever its parent changes size)
 */
ParallelCoordinatesChart.prototype.updateSize = function() {
	this.parentRect = this.parent.node().getBoundingClientRect();
	this.internalWidth = this.parentRect.width - this.margin.left - this.margin.right;
	this.internalHeight = this.parentRect.height - this.margin.top - this.margin.bottom;

	this.svg.attr('viewBox',
						(-this.margin.right)+' '+
						(-this.margin.top)+' '+
						(this.parentRect.width)+' '+
						(this.parentRect.height));

	this.x = d3.scale.ordinal().rangePoints([0, this.internalWidth], 1).domain(this.dimensions);
	var self = this;

	//save the old extents of the brushes before recreating scales.
	//(these are applied to the new brushes when they are recreated)
	var oldExtents = this.dimensions.map(function(p){return self.y[p].brush.extent().slice();});

	this.dimensions.forEach(function(d) {
		self.y[d].range([self.internalHeight,0]);
	});
	this.paths.attr("d", function(d){return self.getPath(d)});
	this.axes.attr("transform", function(d) {
						return "translate("+self.getPosition(d)+")";
					});
	this.axes.each(function(d) {
		d3.select(this).call(self.axis.scale(self.y[d]));
		//self.y[d].brush.extent(self.y[d].brush.extent());
	});

	//recreate brushes
	self.axes.selectAll('g.brush').remove();
	self.axes.append("g")
		.attr("class", "brush")
		.each(function(d, i) {
			d3.select(this).call(self.y[d].brush = d3.svg.brush().y(self.y[d])
									.on('brushstart', brushstart)
									.on('brush',function(){return self.brush()})
									.extent(oldExtents[i]));
		})
		.selectAll("rect")
			.attr('x', -8)
			.attr('width', 16)
		;
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