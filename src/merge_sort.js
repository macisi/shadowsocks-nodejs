const merge = (left, right, comparison) => {
  let result = [];
  while(left.length > 0 && right.length > 0) {
    if (comparison(left[0], right[0]) <= 0) {
      result.push(left.shift());
    } else {
      result.push(right.shift());
    }
  }
  while (left.length > 0) {
    result.push(left.shift());
  }
  while (right.length > 0) {
    result.push(right.shift());
  }
  return result;
}

const merge_sort = (array, comparison) => {
  let middle;
  if (array.length < 2) {
    return array;
  }
  middle = Math.ceil(array.length / 2);
  return merge(merge_sort(array.slice(0, middle), comparison), merge_sort(array.slice(middle), comparison), comparison);
};

exports.merge_sort = merge_sort;